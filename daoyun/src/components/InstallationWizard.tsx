import { useRef, useState } from "react"
import type { FormEvent } from "react"
import { AlertCircle, ArrowRight, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react"

import {
  initializeInstallation,
  InstallationApiError,
} from "../api/installation"
import type { InitializeInstallationInput } from "../api/installation"
import { BrandMark } from "./BrandMark"

type FieldName = "username" | "email" | "display_name" | "password"
type FieldErrors = Partial<Record<FieldName, string>>
type SubmissionPhase = "idle" | "submitting" | "retryable"

const usernamePattern = /^[a-z][a-z0-9_]{2,31}$/
const emailPattern = /^[^\s@]+@[^\s@]+$/
const controlCharacterPattern = /\p{Cc}/u
const fieldNames = new Set<FieldName>(["username", "email", "display_name", "password"])

interface InstallationWizardProps {
  onConfirmInstallation: () => Promise<boolean>
}

export function InstallationWizard({ onConfirmInstallation }: InstallationWizardProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [phase, setPhase] = useState<SubmissionPhase>("idle")
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false)
  const submissionRef = useRef(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submissionRef.current || phase === "submitting") return
    if (awaitingConfirmation) {
      submissionRef.current = true
      try { await confirmCompletion() }
      finally { submissionRef.current = false }
      return
    }

    const input = readInstallationInput(event.currentTarget)
    const validationErrors = validateInstallationInput(input)
    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors)
      setFormError(null)
      focusFirstInvalidField(validationErrors)
      return
    }

    submissionRef.current = true
    setFieldErrors({})
    setFormError(null)
    setPhase("submitting")

    try {
      await initializeInstallation(input)
      setAwaitingConfirmation(true)
      await confirmCompletion()
    } catch (error) {
      if (error instanceof InstallationApiError && error.status === 422) {
        const { fields, message } = mapServerValidationErrors(error)
        setFieldErrors(fields)
        setFormError(message)
        setPhase("idle")
        focusFirstInvalidField(fields)
        return
      }
      if (error instanceof InstallationApiError && error.status === 409) {
        setAwaitingConfirmation(true)
        await confirmCompletion()
        return
      }

      setFormError(error instanceof InstallationApiError && error.status === 503
        ? "安装服务暂时不可用，请稍后重试"
        : "初始化请求失败，请稍后重试")
      setPhase("retryable")
    } finally {
      submissionRef.current = false
    }
  }

  async function confirmCompletion() {
    setFormError(null)
    setPhase("submitting")

    try {
      if (!await onConfirmInstallation()) {
        setFormError("初始化状态尚未确认，请重试检查")
        setPhase("retryable")
      }
    } catch {
      setFormError("初始化结果暂时无法确认，请重试检查")
      setPhase("retryable")
    }
  }

  function handleFieldInput(event: FormEvent<HTMLInputElement>) {
    const field = event.currentTarget.name as FieldName
    if (fieldErrors[field]) {
      setFieldErrors((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
    }
    if (formError) {
      setFormError(null)
    }
  }

  const buttonLabel = phase === "submitting"
    ? "正在初始化"
    : awaitingConfirmation
      ? "重试检查状态"
      : phase === "retryable"
        ? "重试初始化"
        : "完成初始化"

  return (
    <div className="installation-page">
      <header className="installation-header">
        <span className="installation-brand">
          <BrandMark />
          <strong>刀云</strong>
        </span>
        <span>实例初始化</span>
      </header>
      <main className="installation-main">
        <section className="installation-panel" aria-labelledby="installation-heading">
          <div className="installation-panel__heading">
            <span className="installation-heading-icon" aria-hidden="true">
              <ShieldCheck size={21} />
            </span>
            <div>
              <p>首次设置</p>
              <h1 id="installation-heading">初始化刀云</h1>
            </div>
          </div>

          <form className="installation-form" noValidate aria-busy={phase === "submitting"} onSubmit={handleSubmit}>
            {formError && (
              <div className="installation-form-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <InstallationField
              id="installation-username"
              name="username"
              label="管理员用户名"
              autoComplete="username"
              maxLength={32}
              pattern="[a-z][a-z0-9_]{2,31}"
              spellCheck={false}
              error={fieldErrors.username}
              onInput={handleFieldInput}
            />
            <InstallationField
              id="installation-email"
              name="email"
              label="管理员邮箱"
              type="email"
              autoComplete="email"
              maxLength={254}
              spellCheck={false}
              error={fieldErrors.email}
              onInput={handleFieldInput}
            />
            <InstallationField
              id="installation-display-name"
              name="display_name"
              label="显示名称"
              autoComplete="name"
              error={fieldErrors.display_name}
              onInput={handleFieldInput}
            />
            <InstallationField
              id="installation-password"
              name="password"
              label="管理员密码"
              type="password"
              autoComplete="new-password"
              minLength={6}
              error={fieldErrors.password}
              onInput={handleFieldInput}
            />

            <button className="primary-button installation-submit" type="submit" disabled={phase === "submitting"}>
              {phase === "submitting" ? (
                <LoaderCircle className="installation-spinner" size={16} aria-hidden="true" />
              ) : phase === "retryable" ? (
                <RefreshCw size={16} aria-hidden="true" />
              ) : (
                <ArrowRight size={16} aria-hidden="true" />
              )}
              {buttonLabel}
            </button>
          </form>
        </section>
      </main>
    </div>
  )
}

interface InstallationFieldProps {
  id: string
  name: FieldName
  label: string
  type?: "email" | "password" | "text"
  autoComplete: string
  minLength?: number
  maxLength?: number
  pattern?: string
  spellCheck?: boolean
  error?: string
  onInput: (event: FormEvent<HTMLInputElement>) => void
}

function InstallationField({ error, label, type = "text", ...inputProps }: InstallationFieldProps) {
  const errorId = `${inputProps.id}-error`

  return (
    <div className="installation-field">
      <label htmlFor={inputProps.id}>{label}</label>
      <input
        {...inputProps}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error && <p id={errorId}>{error}</p>}
    </div>
  )
}

function readInstallationInput(form: HTMLFormElement): InitializeInstallationInput {
  const data = new FormData(form)
  return {
    username: String(data.get("username") ?? ""),
    email: String(data.get("email") ?? "").trim(),
    displayName: String(data.get("display_name") ?? "").trim(),
    password: String(data.get("password") ?? ""),
  }
}

function validateInstallationInput(input: InitializeInstallationInput): FieldErrors {
  const errors: FieldErrors = {}
  if (!usernamePattern.test(input.username)) {
    errors.username = "用户名需以小写字母开头，只能包含小写字母、数字或下划线，共 3-32 位"
  }
  if (countCharacters(input.email) > 254 || !emailPattern.test(input.email)) {
    errors.email = "请输入有效的邮箱地址"
  }

  const displayNameLength = countCharacters(input.displayName)
  if (displayNameLength === 0) {
    errors.display_name = "请输入显示名称"
  } else if (displayNameLength > 80 || controlCharacterPattern.test(input.displayName)) {
    errors.display_name = "显示名称需为 1-80 个字符且不能包含控制字符"
  }

  const passwordLength = countCharacters(input.password)
  if (passwordLength < 6 || passwordLength > 128) {
    errors.password = "密码长度需为 6-128 个字符"
  }
  return errors
}

function mapServerValidationErrors(error: InstallationApiError): {
  fields: FieldErrors
  message: string | null
} {
  const fields: FieldErrors = {}
  const formMessages: string[] = []

  for (const [field, messages] of Object.entries(error.fields)) {
    if (fieldNames.has(field as FieldName)) {
      fields[field as FieldName] = messages.join("；")
    } else {
      formMessages.push(...messages)
    }
  }

  return {
    fields,
    message: formMessages.length > 0
      ? formMessages.join("；")
      : Object.keys(fields).length === 0 ? error.message : null,
  }
}

function focusFirstInvalidField(errors: FieldErrors) {
  const firstField = Object.keys(errors)[0]
  if (firstField) {
    document.querySelector<HTMLInputElement>(`[name="${firstField}"]`)?.focus()
  }
}

function countCharacters(value: string): number {
  return [...value].length
}
