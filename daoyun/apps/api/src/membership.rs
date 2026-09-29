use api_contract::{
    ApiResponse, ErrorBody, ErrorCode, ErrorResponse, GrowthLevel, Medal, MembershipCatalog,
    MembershipGroup, MembershipLevel, RequestId, error_codes,
};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::get,
};
use infrastructure::{Database, GrowthLevelRecord, MembershipLevelRuleRecord};

const LEVEL_ASSETS: [(&str, &str); 20] = [
    (
        "20080719_088a9b23b0ec44b8fd22LuK36vSjfQrg.gif",
        "f66347257d01dbe6678db3865ed31e971d3a2fe94d428ea37667cc5bbc7b3821",
    ),
    (
        "20080719_0ae83963123b4f635689n5qIWMGMIPl2.gif",
        "6c42fde7c3c9bdd88e9e2c62c56c1280e7b0d4ceba81d45fd04f378add9d2c60",
    ),
    (
        "20080719_0c3fde780e38c8e19df5CTn8XOZU59GS.gif",
        "1f4f3cb836eaf60d3c4ea703a238bd5ef3973a8cd62014fc58c80bc5da8a92de",
    ),
    (
        "20080719_209f775b6c534999541dbISLZvrQVvaC.gif",
        "4d19c3f9ddb6d95ec88d9b4a2b34b543b86e4aacb787e7918c247a0e7f4a10bc",
    ),
    (
        "20080719_263fd1327bf56cbd2e625jQisOQLJS9V.gif",
        "55602725aec6100b33394d1e63463b812f5dccdac2bfa95bf650ab9f366dc7f4",
    ),
    (
        "20080719_3d2503966f96ff156fb1zMVqMTxEkJZx.gif",
        "a11ccdbb7873fedc5471ec476b1438596e67438808538e12815c8a3e83aee31c",
    ),
    (
        "20080719_3ea023bf8eafafd0375dAekVDT71rrz1.gif",
        "3d76ef9c9f84613f29ccc1866a4b85d79e30dba11f834654cc676bda69927072",
    ),
    (
        "20080719_3ed0b9b9ed00347e91b9TQvnnIOke4la.gif",
        "93b327b994e3011b342e844619e0b8dd810e87632a101d06956a98040931c579",
    ),
    (
        "20080719_420d737df4f722d415ff3JBIfBGhCmDq.gif",
        "67868ff44a6e7230e326f551651c1ac098b72dd1766373f1b1a22cc8cdd0f6c8",
    ),
    (
        "20080719_50ba9e54bee76976d97alPXLkGhO8NDQ.gif",
        "72fc0679b559b17bf64803422a9c5ea8f512368df8f8acf0093837fe2b6c1688",
    ),
    (
        "20080719_659e71490b0a066b029beZlrjCFVRQc5.gif",
        "97e8ac0d85438c6067098dbbdb3d67cfcb13774b85f9d4ca1131f81dac1da4e3",
    ),
    (
        "20080719_7c4928e110d7c34dacc1mHVze5kPjrBj.gif",
        "dfe8650d2d8d0e4b8e2f2973a25201f6612f304ed7dbde11c114f367d9288bc5",
    ),
    (
        "20080719_8fe7ccc67768464325d1v3TtCnTH18Xt.gif",
        "4c62e5c253891200e53f925eee1718216f71526440e82f4a87c1bf941e3899a2",
    ),
    (
        "20080719_a78351e3e68db0964425lyJxXlCcGXby.gif",
        "ea9ed8a3f72373044ff29e1cd99cbb2e2ca024da5ddbd79647dd1760885c80d9",
    ),
    (
        "20080719_c0e7a4964d1ac6571aa5oBhj5qAP4JTk.gif",
        "8a98776f7a5bfd7ed757ac9b05c0a6810ffccbeb2f97634d212d2435b883d76b",
    ),
    (
        "20080719_d265dfd41ad590a085f2Z66xMtgg0Rff.gif",
        "895317246e5f07c2788f48df228dd6c403303cfded7e53697a0a402274995c29",
    ),
    (
        "20080719_d3d03e365b841cf16187XZGTlKark4qi.gif",
        "4279818ddee7175739a6c8a51b39b5c9ac220df9dbc348ef6d640fce21a27eb7",
    ),
    (
        "20080719_e7dbca87d6fe018e98d5wouWae7ZuZfw.gif",
        "634adc4c7949487dddae00cdbb6d88ba1e12d5719546f09d125ffc9d1ee53ae6",
    ),
    (
        "20080719_f08383490d3c33946882CVYbkR4Jdzh9.gif",
        "fd3cb169fa018e62ed8b8e414ffc2aa3fe2762a3d6eafe1a807781d76d68805f",
    ),
    (
        "20080719_f5b5a24475998b5da076DvS9r62CCAaW.gif",
        "72fc0679b559b17bf64803422a9c5ea8f512368df8f8acf0093837fe2b6c1688",
    ),
];

const MEDAL_ASSETS: [(&str, &str); 17] = [
    (
        "medal1.gif",
        "0348d50541d10be7770bd5bbdad1b330b6db461964df0f435cf76f5e456c63c6",
    ),
    (
        "medal2.gif",
        "7b13a2159d7871d19bec98e2eafe14d8873be7aff7f54cb9d40b90f455ca2c66",
    ),
    (
        "medal3.gif",
        "49e7f04ef74b77ceede523e4968d9f080f61a7229e225ead5463c9a01298c87c",
    ),
    (
        "medal4.gif",
        "c28cb36998ec92260416cf3d049626058e5657126cc9f69f79860a8d128c39f0",
    ),
    (
        "medal5.gif",
        "6652580541735745ea7551587c202bc2dac2fcfe6df4ee1cf0d4a16bb8c0f34e",
    ),
    (
        "medal6.gif",
        "8662561685aeaa98de741d3ce003a320cf088d013434f8369da8a3fb4018ff16",
    ),
    (
        "medal7.gif",
        "04666c978b244bec01d849c8ae4a85050747a413271171e6104432d4136b1d88",
    ),
    (
        "medal8.gif",
        "f76f4ebc2b3f291ce81595e11942c908d5c8ed300e6df2e60b16ba5662506569",
    ),
    (
        "medal9.gif",
        "2f577b4551eae6445fa2731e59615d64ff4d8694400ab427874af8cea56a519f",
    ),
    (
        "medal10.gif",
        "1f4aaec946fe235d2029c224fc893e4348cf991ada3fa2d33e9d2009632006d5",
    ),
    (
        "medal11.gif",
        "de4e0129ddbcc47e2048eff35cf7bc7402767d21a813de2cc21be16d9aafa096",
    ),
    (
        "medal12.gif",
        "f98a8be8d658f9dbca944a073da78ff68da1b21917c559ec7d4ee5c59b23fa12",
    ),
    (
        "medal13.gif",
        "d56f05d8bb1c38b245a58abd57b59aa69f44778f3687e330a3a0bbdad3a5c496",
    ),
    (
        "medal14.gif",
        "bd45cd158492b7e2742d54a88ff84bdf5c4c6ebcc01999e9737f671c9fd412b6",
    ),
    (
        "medal15.gif",
        "b88ca51d70faac9d9a3aba781200c24a2922dbc2def51bccc542120d9b64fb37",
    ),
    (
        "medal16.gif",
        "61dfbeb128895137955da9f9d4be32d87055977a4858f8f81fef7ab89c70c658",
    ),
    (
        "medal17.gif",
        "4a853a2b5172a00cf234c33f575d2fe2cd0316426ff513c7731501ab19bd30c5",
    ),
];

pub(crate) fn medal_asset_metadata(key: &str) -> Option<(String, String)> {
    if let Some(hash) = infrastructure::uploaded_medal_sha256(key) {
        return Some((
            format!("/api/v1/membership/medal-assets/{key}"),
            hash.to_owned(),
        ));
    }
    let number = key.strip_prefix("medal_")?.parse::<usize>().ok()?;
    if number == 0 || number > MEDAL_ASSETS.len() {
        return None;
    }
    let (filename, sha256) = MEDAL_ASSETS[number - 1];
    Some((
        format!("/assets/membership/medals/{filename}"),
        sha256.to_owned(),
    ))
}

pub(crate) fn level_asset_metadata(number: i16) -> Option<(&'static str, &'static str)> {
    LEVEL_ASSETS.get(number.checked_sub(1)? as usize).copied()
}

pub(crate) fn router() -> Router<Database> {
    Router::new()
        .route("/api/v1/membership/catalog", get(catalog))
        .route("/api/v1/membership/levels", get(levels))
}

#[utoipa::path(
    get,
    path = "/api/v1/membership/levels",
    operation_id = "listMembershipGrowthLevels",
    tag = "membership",
    responses(
        (
            status = 200,
            description = "Published dynamic membership growth levels",
            body = ApiResponse<Vec<GrowthLevel>>,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (status = 503, description = "Membership levels are unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn levels(
    Extension(request_id): Extension<RequestId>,
    State(database): State<Database>,
) -> Result<Json<ApiResponse<Vec<GrowthLevel>>>, crate::auth::ApiError> {
    let levels = database
        .list_published_growth_levels()
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Membership growth levels query failed");
            catalog_unavailable(request_id)
        })?
        .into_iter()
        .map(growth_level)
        .collect();
    Ok(Json(ApiResponse::new(levels, request_id)))
}

#[utoipa::path(
    get,
    path = "/api/v1/membership/catalog",
    operation_id = "getMembershipCatalog",
    tag = "membership",
    responses(
        (
            status = 200,
            description = "Stable membership, level and medal resource catalog",
            body = ApiResponse<MembershipCatalog>,
            headers(("x-request-id" = String, description = "Request correlation identifier"))
        ),
        (status = 503, description = "Membership catalog is unavailable", body = ErrorResponse)
    )
)]
pub(crate) async fn catalog(
    Extension(request_id): Extension<RequestId>,
    State(database): State<Database>,
) -> Result<Json<ApiResponse<MembershipCatalog>>, crate::auth::ApiError> {
    let rules = database
        .list_membership_level_rules()
        .await
        .map_err(|error| {
            tracing::warn!(request_id = %request_id, error = %error, "Membership catalog query failed");
            catalog_unavailable(request_id)
        })?;
    let medal_rules = database
        .list_membership_medal_rules()
        .await
        .map_err(|_| catalog_unavailable(request_id))?;
    let catalog =
        build_catalog(&rules, &medal_rules).ok_or_else(|| catalog_unavailable(request_id))?;
    Ok(Json(ApiResponse::new(catalog, request_id)))
}

fn build_catalog(
    rules: &[MembershipLevelRuleRecord],
    medal_rules: &[infrastructure::MembershipMedalRuleRecord],
) -> Option<MembershipCatalog> {
    let levels = rules
        .iter()
        .map(|rule| {
            let (filename, sha256) = level_asset_metadata(rule.level_number)?;
            Some((
                rule.level_number,
                MembershipLevel {
                    key: rule.level_key.clone(),
                    level_number: rule.level_number,
                    display_name: rule.level_display_name.clone(),
                    asset_url: format!("/assets/membership/levels/{filename}"),
                    sha256: (*sha256).to_owned(),
                },
            ))
        })
        .collect::<Option<Vec<_>>>()?;
    if levels.is_empty()
        || levels
            .iter()
            .enumerate()
            .any(|(index, (number, _))| *number != index as i16 + 1)
    {
        return None;
    }
    let levels = levels
        .into_iter()
        .map(|(_, level)| level)
        .collect::<Vec<_>>();
    let medals = medal_rules
        .iter()
        .map(|rule| {
            let (asset_url, sha256) = medal_asset_metadata(&rule.asset_key)?;
            Some(Medal {
                key: rule.medal_key.clone(),
                display_name: rule.display_name.clone(),
                asset_url,
                sha256: sha256.to_owned(),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let (filename, sha256) = LEVEL_ASSETS[0];
    Some(MembershipCatalog {
        member_group: MembershipGroup {
            key: "member".to_owned(),
            display_name: "会员".to_owned(),
            asset_url: format!("/assets/membership/levels/{filename}"),
            sha256: sha256.to_owned(),
        },
        levels,
        medals,
    })
}

pub(crate) fn growth_level(record: GrowthLevelRecord) -> GrowthLevel {
    GrowthLevel {
        id: record.id,
        internal_key: record.internal_key,
        level_order: record.level_order,
        display_name: record.display_name,
        required_experience: record.required_experience,
        icon_asset_id: record.icon_asset_id,
        color: record.color,
        description: record.description,
    }
}

fn catalog_unavailable(request_id: RequestId) -> crate::auth::ApiError {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        HeaderMap::new(),
        Json(ErrorResponse::new(
            ErrorBody::new(
                ErrorCode::from_static(error_codes::DATABASE_UNAVAILABLE),
                "会员资源目录暂时不可用",
            ),
            request_id,
        )),
    )
}
