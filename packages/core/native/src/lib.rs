mod frame;
mod paint;
mod shapes;
use serde::Deserialize;
use std::sync::Arc;
use takumi::prelude::{FontOverride, FontResource, FontSource, Fonts, GenericFamily, UnicodeRange};
use takumi::unstable::base::resources::font::LoadedFont;
use wasm_bindgen::prelude::*;
#[derive(Default)]
#[wasm_bindgen]
pub struct Renderer {
    fonts: Fonts,
    overrides: Vec<LoadedFont>,
    generic: Vec<LoadedFont>,
    host_files: Vec<Arc<Vec<u8>>>,
}

#[derive(Deserialize)]
struct FontFace {
    family: String,
    weight: Option<f32>,
    ranges: Option<Vec<(u32, u32)>>,
}

#[wasm_bindgen]
impl Renderer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Renderer {
        Self::default()
    }

    #[wasm_bindgen(js_name = registerFont)]
    pub fn register_font(&mut self, bytes: Vec<u8>, face: JsValue) -> Result<(), JsError> {
        let mut resource = FontResource::new(bytes);
        if let Some(face) = serde_wasm_bindgen::from_value::<Option<FontFace>>(face)? {
            resource = resource
                .override_info(FontOverride {
                    family_name: Some(face.family.into()),
                    weight: face.weight,
                    ..Default::default()
                })
                .unicode_range(
                    face.ranges
                        .unwrap_or_default()
                        .into_iter()
                        .map(|(from, to)| UnicodeRange::new(from, to))
                        .collect(),
                );
        }
        let font = self
            .fonts
            .load(resource)
            .map_err(|e| JsError::new(&e.to_string()))?;
        self.fonts.add(&font);
        self.overrides.push(font);
        Ok(())
    }

    #[wasm_bindgen(js_name = registerSystemFont)]
    pub fn register_system_font(
        &mut self,
        bytes: Vec<u8>,
        generic: Option<String>,
    ) -> Result<(), JsError> {
        if let Some(generic) = generic {
            // A host face standing for a CSS generic family is a registered face, so the family resolves to it.
            let generic = generic
                .parse::<GenericFamily>()
                .map_err(|e| JsError::new(&e.to_string()))?;
            let font = self
                .fonts
                .load(FontResource::new(bytes).generic_family(generic))
                .map_err(|e| JsError::new(&e.to_string()))?;
            self.fonts.add(&font);
            self.generic.push(font);
            return Ok(());
        }
        if self.overrides.is_empty() {
            self.fonts
                .register(FontResource::new(bytes))
                .map_err(|e| JsError::new(&e.to_string()))?;
        } else {
            // Takumi tries document faces first, even if the OS has a family of the same name.
            let file = Arc::new(bytes);
            let resources = self
                .host_files
                .iter()
                .chain([&file])
                .map(|file| FontResource::new(FontSource::from_shared(file.clone())));
            self.fonts = Fonts::with_system_fonts(resources)
                .map_err(|e| JsError::new(&e.to_string()))?
                .with_listed(self.overrides.iter().chain(&self.generic));
            self.host_files.push(file);
        }
        Ok(())
    }
}
