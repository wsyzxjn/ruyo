//! The display list exchanged by an adapter and the shared painter. All geometry is in CSS pixels.
use js_sys::Function;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
pub struct Photo {
    pub url: String,
    pub width: f32,
    pub height: f32,
}

#[derive(Default, Deserialize, Serialize)]
pub struct Run {
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub style: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}
impl Run {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    pub runs: Vec<Run>,
    pub style: String,
    pub max_width: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang: Option<String>,
}
#[derive(Deserialize, Serialize, Clone, Copy)]
pub struct TextBlock {
    pub id: usize,
    pub width: f32,
    pub height: f32,
}

/// Ask the painter to shape this paragraph once. The returned id refers to that exact layout.
pub fn measure(
    prepare: &Function,
    runs: Vec<Run>,
    style: String,
    max_width: f32,
    lang: Option<&str>,
) -> Result<TextBlock, JsValue> {
    let spec = serde_wasm_bindgen::to_value(&Paragraph {
        runs,
        style,
        max_width: max_width.max(0.0),
        lang: lang.map(str::to_owned),
    })?;
    Ok(serde_wasm_bindgen::from_value(
        prepare.call1(&JsValue::UNDEFINED, &spec)?,
    )?)
}

pub type Color = [u8; 4];

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BoxPaint {
    pub radius: f32,
    pub squircle: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<Color>,
    /// Width in CSS pixels and RGBA colour. Borders are painted inside the box.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<(f32, Color)>,
    pub inset: f32,
    pub contain: bool,
    pub rotate_half_turn: bool,
    pub blur: f32,
}
impl BoxPaint {
    pub fn rounded(radius: f32) -> Self {
        Self {
            radius,
            ..Self::default()
        }
    }
    pub fn solid(fill: Color, radius: f32) -> Self {
        Self {
            fill: Some(fill),
            ..Self::rounded(radius)
        }
    }
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Primitive {
    Text { id: usize },
    Rect { paint: BoxPaint },
    Image { src: String, paint: BoxPaint },
    Svg { svg: String },
}
#[derive(Serialize, Deserialize)]
pub struct Item {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<[f32; 4]>,
    #[serde(flatten)]
    pub primitive: Primitive,
}
#[derive(Default, Serialize, Deserialize)]
pub struct DisplayList {
    pub height: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<Color>,
    pub items: Vec<Item>,
    #[serde(default)]
    pub radii: [f32; 4],
}
impl DisplayList {
    pub fn push(
        &mut self,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        primitive: Primitive,
    ) -> &mut Item {
        self.items.push(Item {
            x,
            y,
            width,
            height,
            primitive,
            clip: None,
        });
        self.items.last_mut().unwrap()
    }
    pub fn text(&mut self, x: f32, y: f32, block: TextBlock) {
        self.push(
            x,
            y,
            block.width,
            block.height,
            Primitive::Text { id: block.id },
        );
    }
    pub fn image(
        &mut self,
        src: &str,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
        paint: BoxPaint,
    ) -> &mut Item {
        self.push(
            x,
            y,
            width,
            height,
            Primitive::Image {
                src: src.into(),
                paint,
            },
        )
    }
    pub fn rect(&mut self, x: f32, y: f32, width: f32, height: f32, paint: BoxPaint) {
        self.push(x, y, width, height, Primitive::Rect { paint });
    }
    pub fn svg(&mut self, x: f32, y: f32, size: f32, svg: String) {
        self.push(x, y, size, size, Primitive::Svg { svg });
    }
    pub fn finish(mut self, height: f32) -> Result<JsValue, JsValue> {
        self.height = height.ceil();
        // Flattened enums must be plain objects, including for TypeScript callers.
        Ok(self.serialize(&serde_wasm_bindgen::Serializer::json_compatible())?)
    }
}
