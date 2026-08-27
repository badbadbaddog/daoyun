use std::{error::Error, fmt, future::Future, pin::Pin, sync::Arc, time::Duration as StdDuration};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use infrastructure::{ClaimedOutboxEvent, Database};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
    transport::smtp::authentication::Credentials,
};
use rand_core::{OsRng, RngCore};
use time::OffsetDateTime;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{HandlerFuture, OutboxHandler, OutboxHandlerError};

const CIPHERTEXT_VERSION: u8 = 1;
const NONCE_BYTES: usize = 12;

#[derive(Clone)]
pub struct EmailRuntime {
    key: Option<[u8; 32]>,
    sender: Arc<dyn EmailSender>,
}

pub type EmailSenderFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), EmailSendError>> + Send + 'a>>;

pub trait EmailSender: Send + Sync {
    fn send<'a>(
        &'a self,
        settings: SmtpConnectionSettings,
        email: OutboundEmail,
    ) -> EmailSenderFuture<'a>;
}

pub struct SmtpConnectionSettings {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<Zeroizing<String>>,
    pub tls_mode: String,
    pub from_email: String,
    pub from_name: String,
}

pub struct OutboundEmail {
    pub recipient_email: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailSendError {
    Disabled,
    InvalidConfiguration,
    Unavailable,
}

impl fmt::Display for EmailSendError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disabled => formatter.write_str("SMTP is disabled"),
            Self::InvalidConfiguration => formatter.write_str("SMTP configuration is invalid"),
            Self::Unavailable => formatter.write_str("SMTP delivery is unavailable"),
        }
    }
}

impl Error for EmailSendError {}

struct LettreEmailSender;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailConfigError {
    InvalidBase64,
    InvalidLength,
    EncryptionUnavailable,
    InvalidCiphertext,
}

impl fmt::Display for EmailConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidBase64 => {
                formatter.write_str("DAOYUN_SMTP_ENCRYPTION_KEY must be base64 encoded")
            }
            Self::InvalidLength => {
                formatter.write_str("DAOYUN_SMTP_ENCRYPTION_KEY must decode to exactly 32 bytes")
            }
            Self::EncryptionUnavailable => {
                formatter.write_str("SMTP encryption key is not configured")
            }
            Self::InvalidCiphertext => formatter.write_str("encrypted email secret is invalid"),
        }
    }
}

impl Error for EmailConfigError {}

impl EmailRuntime {
    pub fn disabled() -> Self {
        Self {
            key: None,
            sender: Arc::new(LettreEmailSender),
        }
    }

    pub fn from_key(key: [u8; 32]) -> Self {
        Self {
            key: Some(key),
            sender: Arc::new(LettreEmailSender),
        }
    }

    pub fn from_key_and_sender(key: [u8; 32], sender: Arc<dyn EmailSender>) -> Self {
        Self {
            key: Some(key),
            sender,
        }
    }

    pub fn from_environment() -> Result<Self, EmailConfigError> {
        let value = match std::env::var("DAOYUN_SMTP_ENCRYPTION_KEY") {
            Ok(value) => value,
            Err(std::env::VarError::NotPresent) => return Ok(Self::disabled()),
            Err(std::env::VarError::NotUnicode(_)) => {
                return Err(EmailConfigError::InvalidBase64);
            }
        };
        let decoded = BASE64
            .decode(value)
            .map_err(|_| EmailConfigError::InvalidBase64)?;
        let key = decoded
            .try_into()
            .map_err(|_| EmailConfigError::InvalidLength)?;
        Ok(Self::from_key(key))
    }

    pub fn is_enabled(&self) -> bool {
        self.key.is_some()
    }

    pub fn encrypt_smtp_password(&self, value: &str) -> Result<Vec<u8>, EmailConfigError> {
        self.encrypt(value.as_bytes(), b"smtp_configuration:password:v1")
    }

    pub fn decrypt_smtp_password(
        &self,
        value: &[u8],
    ) -> Result<Zeroizing<String>, EmailConfigError> {
        let plaintext = self.decrypt(value, b"smtp_configuration:password:v1")?;
        String::from_utf8(plaintext.to_vec())
            .map(Zeroizing::new)
            .map_err(|_| EmailConfigError::InvalidCiphertext)
    }

    pub fn encrypt_registration_code(
        &self,
        challenge_id: Uuid,
        code: &str,
    ) -> Result<Vec<u8>, EmailConfigError> {
        self.encrypt(
            code.as_bytes(),
            registration_code_aad(challenge_id).as_bytes(),
        )
    }

    pub fn decrypt_registration_code(
        &self,
        challenge_id: Uuid,
        value: &[u8],
    ) -> Result<Zeroizing<String>, EmailConfigError> {
        let aad = registration_code_aad(challenge_id);
        let plaintext = self.decrypt(value, aad.as_bytes())?;
        String::from_utf8(plaintext.to_vec())
            .map(Zeroizing::new)
            .map_err(|_| EmailConfigError::InvalidCiphertext)
    }

    pub async fn send(
        &self,
        database: &Database,
        email: OutboundEmail,
    ) -> Result<(), EmailSendError> {
        let record = database
            .get_smtp_configuration()
            .await
            .map_err(|_| EmailSendError::Unavailable)?;
        if !record.enabled {
            return Err(EmailSendError::Disabled);
        }
        let password = record
            .password_ciphertext
            .as_deref()
            .map(|ciphertext| self.decrypt_smtp_password(ciphertext))
            .transpose()
            .map_err(|_| EmailSendError::InvalidConfiguration)?;
        let settings = SmtpConnectionSettings {
            host: record.host,
            port: u16::try_from(record.port).map_err(|_| EmailSendError::InvalidConfiguration)?,
            username: record.username,
            password,
            tls_mode: record.tls_mode,
            from_email: record.from_email,
            from_name: record.from_name,
        };
        self.sender.send(settings, email).await
    }

    fn encrypt(&self, value: &[u8], aad: &[u8]) -> Result<Vec<u8>, EmailConfigError> {
        let key = self.key.ok_or(EmailConfigError::EncryptionUnavailable)?;
        if value.is_empty() {
            return Err(EmailConfigError::InvalidLength);
        }
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| EmailConfigError::InvalidLength)?;
        let mut nonce_bytes = [0_u8; NONCE_BYTES];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from(nonce_bytes);
        let ciphertext = cipher
            .encrypt(&nonce, Payload { msg: value, aad })
            .map_err(|_| EmailConfigError::InvalidCiphertext)?;
        let mut output = Vec::with_capacity(1 + NONCE_BYTES + ciphertext.len());
        output.push(CIPHERTEXT_VERSION);
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);
        Ok(output)
    }

    fn decrypt(&self, value: &[u8], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, EmailConfigError> {
        let key = self.key.ok_or(EmailConfigError::EncryptionUnavailable)?;
        if value.len() <= 1 + NONCE_BYTES || value[0] != CIPHERTEXT_VERSION {
            return Err(EmailConfigError::InvalidCiphertext);
        }
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| EmailConfigError::InvalidLength)?;
        let nonce = Nonce::try_from(&value[1..1 + NONCE_BYTES])
            .map_err(|_| EmailConfigError::InvalidCiphertext)?;
        cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: &value[1 + NONCE_BYTES..],
                    aad,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| EmailConfigError::InvalidCiphertext)
    }
}

impl EmailSender for LettreEmailSender {
    fn send<'a>(
        &'a self,
        settings: SmtpConnectionSettings,
        email: OutboundEmail,
    ) -> EmailSenderFuture<'a> {
        Box::pin(async move {
            crate::install_rustls_crypto_provider();
            let from_address = settings
                .from_email
                .parse()
                .map_err(|_| EmailSendError::InvalidConfiguration)?;
            let recipient = email
                .recipient_email
                .parse()
                .map_err(|_| EmailSendError::InvalidConfiguration)?;
            let message = Message::builder()
                .from(Mailbox::new(Some(settings.from_name), from_address))
                .to(Mailbox::new(None, recipient))
                .subject(email.subject)
                .header(ContentType::TEXT_PLAIN)
                .body(email.body)
                .map_err(|_| EmailSendError::InvalidConfiguration)?;

            // Source: https://docs.rs/lettre/0.11.23/lettre/transport/smtp/struct.AsyncSmtpTransport.html
            let builder = match settings.tls_mode.as_str() {
                "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&settings.host),
                "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&settings.host),
                "none" => Ok(AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
                    &settings.host,
                )),
                _ => return Err(EmailSendError::InvalidConfiguration),
            }
            .map_err(|_| EmailSendError::InvalidConfiguration)?
            .port(settings.port)
            .timeout(Some(StdDuration::from_secs(10)));
            let builder = match (settings.username, settings.password) {
                (Some(username), Some(password)) => {
                    builder.credentials(Credentials::new(username, password.to_string()))
                }
                (None, None) => builder,
                _ => return Err(EmailSendError::InvalidConfiguration),
            };
            builder
                .build()
                .send(message)
                .await
                .map(|_| ())
                .map_err(|_| EmailSendError::Unavailable)
        })
    }
}

#[derive(Clone)]
pub struct RegistrationEmailHandler {
    database: Database,
    runtime: EmailRuntime,
}

impl RegistrationEmailHandler {
    pub fn new(database: Database, runtime: EmailRuntime) -> Self {
        Self { database, runtime }
    }
}

impl OutboxHandler for RegistrationEmailHandler {
    fn event_type(&self) -> &'static str {
        "email.registration_verification_requested"
    }

    fn handle<'a>(&'a self, event: &'a ClaimedOutboxEvent) -> HandlerFuture<'a> {
        Box::pin(async move {
            let challenge = self
                .database
                .get_registration_email_challenge(event.aggregate_id)
                .await
                .map_err(|_| OutboxHandlerError::new("email challenge lookup failed"))?
                .ok_or_else(|| OutboxHandlerError::new("email challenge not found"))?;
            if challenge.delivered_at.is_some()
                || challenge.consumed_at.is_some()
                || challenge.expires_at <= OffsetDateTime::now_utc()
            {
                return Ok(());
            }
            let ciphertext = challenge
                .code_ciphertext
                .as_deref()
                .ok_or_else(|| OutboxHandlerError::new("email challenge secret unavailable"))?;
            let code = self
                .runtime
                .decrypt_registration_code(challenge.id, ciphertext)
                .map_err(|_| OutboxHandlerError::new("email challenge decryption failed"))?;
            self.runtime
                .send(
                    &self.database,
                    OutboundEmail {
                        recipient_email: challenge.email,
                        subject: "DaoYun 注册验证码".to_owned(),
                        body: format!(
                            "你的 DaoYun 注册验证码是：{}\n\n验证码 10 分钟内有效，请勿转发。",
                            code.as_str()
                        ),
                    },
                )
                .await
                .map_err(|_| OutboxHandlerError::new("SMTP delivery failed"))?;
            self.database
                .mark_registration_email_delivered(challenge.id)
                .await
                .map_err(|_| OutboxHandlerError::new("email delivery state update failed"))?;
            Ok(())
        })
    }
}

fn registration_code_aad(challenge_id: Uuid) -> String {
    format!("registration_email_challenge:code:v1:{challenge_id}")
}

#[cfg(test)]
mod tests {
    use super::{EmailConfigError, EmailRuntime};
    use uuid::Uuid;

    #[test]
    fn secrets_round_trip_and_are_bound_to_their_purpose() {
        let runtime = EmailRuntime::from_key([23_u8; 32]);
        let password = runtime
            .encrypt_smtp_password("super-secret")
            .expect("password must encrypt");
        assert!(!String::from_utf8_lossy(&password).contains("super-secret"));
        assert_eq!(
            runtime
                .decrypt_smtp_password(&password)
                .expect("password must decrypt")
                .as_str(),
            "super-secret"
        );

        let challenge_id = Uuid::now_v7();
        let code = runtime
            .encrypt_registration_code(challenge_id, "123456")
            .expect("code must encrypt");
        assert_eq!(
            runtime
                .decrypt_registration_code(challenge_id, &code)
                .expect("code must decrypt")
                .as_str(),
            "123456"
        );
        assert!(matches!(
            runtime.decrypt_registration_code(Uuid::now_v7(), &code),
            Err(EmailConfigError::InvalidCiphertext)
        ));
    }
}
