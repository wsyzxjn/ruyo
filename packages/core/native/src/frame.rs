use super::{Renderer, paint::draw_box, shapes::outline};
use ruyo_layout::{BoxPaint, DisplayList, Item, Paragraph, Primitive, TextBlock};
use std::{collections::HashMap, sync::Arc};
use takumi::prelude::{Cache, ImageCacheMode, ImageSource, Node, RenderOptions, Viewport};
use takumi::unstable::{
    base::{layout::tree::RenderNode, resources::image_buffer::premultiply_pixel, scene::Scene},
    raster,
};
use takumi_core::{context::RenderContext, style::Lang};
use tiny_skia::{
    FillRule, IntRect, Mask, PathBuilder, Pixmap, PixmapPaint, PixmapRef, Rect, Transform,
};
use wasm_bindgen::prelude::*;

fn error(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}
fn styled(node: Node, css: &str) -> Result<Node, JsError> {
    Ok(node.with_style(css.parse().map_err(error)?))
}
#[wasm_bindgen]
pub struct Frame {
    dpr: f32,
    width: u32,
    images: HashMap<Arc<str>, ImageSource>,
    paragraphs: Vec<Scene>,
}
#[wasm_bindgen]
impl Frame {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, dpr: f32) -> Self {
        Self {
            width,
            dpr,
            images: HashMap::new(),
            paragraphs: Vec::new(),
        }
    }
    #[wasm_bindgen(js_name=addImage)]
    pub fn add_image(&mut self, src: String, bytes: &[u8]) -> Result<(), JsError> {
        let image = Cache::shared()
            .decode_image(bytes, ImageCacheMode::Auto)
            .map_err(|e| error(format!("Invalid image: {src} ({e})")))?;
        self.images.insert(Arc::from(src), image);
        Ok(())
    }
    #[wasm_bindgen(js_name=imageSize)]
    pub fn image_size(&self, src: &str) -> Result<Vec<f32>, JsError> {
        let (w, h) = self.image(src)?.dimensions();
        Ok(vec![w, h])
    }
    /// A block is shaped at the final DPR. Keep its actual glyph layout for the paint pass.
    pub fn prepare(
        &mut self,
        renderer: &Renderer,
        spec: JsValue,
        check_fonts: bool,
    ) -> Result<JsValue, JsError> {
        let p: Paragraph = serde_wasm_bindgen::from_value(spec)?;
        let mut spans = Vec::new();
        for run in p.runs {
            let span = if let Some(src) = run.image {
                Node::image(self.image(&src)?)
            } else if run.style.is_empty() {
                spans.push(Node::text(run.text));
                continue;
            } else {
                Node::container(vec![Node::text(run.text)])
            };
            spans.push(styled(span, &format!("display:inline;{}", run.style))?);
        }
        let node = styled(
            Node::container(spans),
            &format!(
                "display:block;width:max-content;max-width:{}px;{}",
                p.max_width, p.style
            ),
        )?;
        let node = if let Some(lang) = p.lang {
            node.with_lang(Lang::parse(&lang).map_err(error)?)
        } else {
            node
        };
        let viewport = Viewport::new((None, None)).with_device_pixel_ratio(self.dpr);
        let mut options = RenderOptions::builder()
            .node(node)
            .fonts(&renderer.fonts)
            .viewport(viewport)
            .build();
        let context = options.take_render_context();
        let root = RenderNode::from_node(&context, options.node().clone());
        let scene = Scene::lay_out(root, viewport, false).map_err(error)?;
        if check_fonts {
            let missing: String = scene.view().uncovered_characters().into_iter().collect();
            if !missing.is_empty() {
                return Ok(JsValue::from_str(&missing));
            }
        }
        let block = TextBlock {
            id: self.paragraphs.len(),
            width: scene.size.width / self.dpr,
            height: scene.size.height / self.dpr,
        };
        self.paragraphs.push(scene);
        Ok(serde_wasm_bindgen::to_value(&block)?)
    }
    pub fn draw(&self, renderer: &Renderer, list: JsValue) -> Result<Vec<u8>, JsError> {
        let list: DisplayList = serde_wasm_bindgen::from_value(list)?;
        let w = (self.width as f32 * self.dpr).round() as u32;
        let h = (list.height * self.dpr).round() as u32;
        if u64::from(w) * u64::from(h) > 64 << 20 {
            return Err(error("Card exceeds raster pixel limit"));
        }
        let mut canvas = Pixmap::new(w, h).ok_or_else(|| error("Invalid card size"))?;
        let [r, g, b, a] = list.background.unwrap_or([255; 4]);
        canvas.fill(tiny_skia::Color::from_rgba8(r, g, b, a));
        let mut opts = RenderOptions::builder()
            .node(Node::container(vec![]))
            .fonts(&renderer.fonts)
            .viewport(Viewport::new((w, h)).with_device_pixel_ratio(self.dpr))
            .build();
        let context = opts.take_render_context();
        for item in list.items {
            self.paint(&mut canvas, &context, &item)?;
        }
        let rounded = list.radii.iter().any(|r| *r > 0.);
        if rounded {
            let mut mask = Mask::new(w, h).ok_or_else(|| error("Invalid clip size"))?;
            if let Some(path) = outline(
                Rect::from_xywh(0., 0., w as f32, h as f32).unwrap(),
                list.radii.map(|r| r * self.dpr),
                false,
            ) {
                mask.fill_path(&path, FillRule::Winding, true, Transform::identity());
                canvas.apply_mask(&mask);
            }
        }
        let mut png = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut png, w, h);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.set_compression(png::Compression::Fast);
            enc.set_filter(png::Filter::Sub);
            let mut writer = enc.write_header().map_err(error)?;
            let bytes = if rounded || a < 255 {
                canvas.take_demultiplied()
            } else {
                canvas.take()
            };
            writer.write_image_data(&bytes).map_err(error)?;
            writer.finish().map_err(error)?;
        }
        Ok(png)
    }
}
impl Frame {
    fn image(&self, src: &str) -> Result<ImageSource, JsError> {
        self.images
            .get(src)
            .cloned()
            .ok_or_else(|| error(format!("Invalid image: missing {src}")))
    }
    fn paint(
        &self,
        canvas: &mut Pixmap,
        context: &RenderContext,
        item: &Item,
    ) -> Result<(), JsError> {
        let Some(rect) = Rect::from_xywh(
            item.x * self.dpr,
            item.y * self.dpr,
            item.width * self.dpr,
            item.height * self.dpr,
        ) else {
            return Ok(());
        };
        let bounds = rect
            .round_out()
            .ok_or_else(|| error("Invalid item bounds"))?;
        let frame = IntRect::from_xywh(0, 0, canvas.width(), canvas.height()).unwrap();
        let Some(visible) = bounds.intersect(&frame) else {
            return Ok(());
        };
        let mut mask = None;
        if let Some([x, y, w, h]) = item.clip {
            let Some(clip) =
                Rect::from_xywh(x * self.dpr, y * self.dpr, w * self.dpr, h * self.dpr)
            else {
                return Ok(());
            };
            let Some(intersection) = clip.intersect(&visible.to_rect()) else {
                return Ok(());
            };
            if intersection != visible.to_rect() {
                let mut m = Mask::new(canvas.width(), canvas.height())
                    .ok_or_else(|| error("Invalid clip size"))?;
                m.fill_path(
                    &PathBuilder::from_rect(clip),
                    FillRule::Winding,
                    true,
                    Transform::identity(),
                );
                mask = Some(m);
            }
        }
        match &item.primitive {
            Primitive::Text { id } => {
                let scene = self
                    .paragraphs
                    .get(*id)
                    .ok_or_else(|| error("Unknown prepared text block"))?;
                if scene.size.width.round() < 1. || scene.size.height.round() < 1. {
                    return Ok(());
                }
                let bitmap = raster::render_scene(scene).map_err(error)?;
                let (bw, bh) = (bitmap.width(), bitmap.height());
                let mut rgba = bitmap.into_raw();
                for pixel in rgba.as_chunks_mut::<4>().0 {
                    if pixel[3] != 255 {
                        *pixel = premultiply_pixel(*pixel);
                    }
                }
                let source = PixmapRef::from_bytes(&rgba, bw, bh)
                    .ok_or_else(|| error("Invalid text surface"))?;
                canvas.draw_pixmap(
                    rect.x().round() as i32,
                    rect.y().round() as i32,
                    source,
                    &PixmapPaint::default(),
                    Transform::identity(),
                    mask.as_ref(),
                );
                Ok(())
            }
            Primitive::Rect { paint } => {
                draw_box(canvas, rect, paint, None, self.dpr, context, mask.as_ref())
            }
            Primitive::Image { src, paint } => draw_box(
                canvas,
                rect,
                paint,
                Some(&self.image(src)?),
                self.dpr,
                context,
                mask.as_ref(),
            ),
            Primitive::Svg { svg } => {
                let source = Cache::shared()
                    .decode_image(svg.as_bytes(), ImageCacheMode::Auto)
                    .map_err(error)?;
                draw_box(
                    canvas,
                    rect,
                    &BoxPaint::default(),
                    Some(&source),
                    self.dpr,
                    context,
                    mask.as_ref(),
                )
            }
        }
    }
}
