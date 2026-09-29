use std::{env, fs};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let output = env::args()
        .nth(1)
        .ok_or("usage: export_openapi <output.json>")?;
    let document = daoyun_api::openapi_document();
    fs::write(output, serde_json::to_vec_pretty(&document)?)?;
    Ok(())
}
