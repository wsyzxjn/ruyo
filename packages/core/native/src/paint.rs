//! Paint already-positioned boxes into the shared pixel buffer.
use crate::shapes::outline;
use ruyo_layout::{BoxPaint, Color};
use takumi_core::{
    context::RenderContext,
    resources::image::{ImageSource, RenderedImage},
    style::ImageScalingAlgorithm,
};
use tiny_skia::{
    FillRule, FilterQuality, Mask, Paint, Pattern, Pixmap, PixmapPaint, PixmapRef, Rect,
    SpreadMode, Stroke, Transform,
};
use wasm_bindgen::JsError;

fn ink([r, g, b, a]: Color) -> Paint<'static> {
    let mut paint = Paint::default();
    paint.set_color_rgba8(r, g, b, a);
    paint
}
fn inset(r: Rect, n: f32) -> Option<Rect> {
    Rect::from_xywh(
        r.x() + n,
        r.y() + n,
        r.width() - 2. * n,
        r.height() - 2. * n,
    )
}

pub(super) fn draw_box(
    canvas: &mut Pixmap,
    rect: Rect,
    style: &BoxPaint,
    source: Option<&ImageSource>,
    dpr: f32,
    host: &RenderContext,
    mask: Option<&Mask>,
) -> Result<(), JsError> {
    if style.blur > 0. {
        let mut layer = Pixmap::new(rect.width().ceil() as u32, rect.height().ceil() as u32)
            .ok_or_else(|| JsError::new("Invalid blur surface"))?;
        let local = Rect::from_xywh(0., 0., rect.width(), rect.height()).unwrap();
        draw_box(
            &mut layer,
            local,
            &BoxPaint { blur: 0., ..*style },
            source,
            dpr,
            host,
            None,
        )?;
        let (w, h) = (layer.width() as usize, layer.height() as usize);
        takumi_core::blur::blur_rgba(
            layer.data_mut().as_chunks_mut::<4>().0,
            w,
            h,
            style.blur * dpr,
        );
        canvas.draw_pixmap(
            rect.x().round() as i32,
            rect.y().round() as i32,
            layer.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            mask,
        );
        return Ok(());
    }
    let radius = style.radius * dpr;
    if let Some(color) = style.fill
        && let Some(path) = outline(rect, [radius; 4], style.squircle)
    {
        canvas.fill_path(
            &path,
            &ink(color),
            FillRule::Winding,
            Transform::identity(),
            mask,
        );
    }
    if let Some(source) = source
        && let Some(slot) = inset(rect, style.inset * dpr)
    {
        let (iw, ih) = source.dimensions();
        let sx = slot.width() / iw;
        let sy = slot.height() / ih;
        let scale = if style.contain {
            sx.min(sy)
        } else {
            sx.max(sy)
        };
        let (w, h) = (iw * scale, ih * scale);
        let x = slot.x() + (slot.width() - w) * 0.5;
        let y = slot.y() + (slot.height() - h) * 0.5;
        // Decode for the displayed size; the decoder's bounded content cache is shared across frames.
        let buffer = match source
            .render_for_layout(
                w.ceil().max(1.) as u32,
                h.ceil().max(1.) as u32,
                ImageScalingAlgorithm::Auto,
                0,
                host,
            )
            .map_err(|e| JsError::new(&format!("Invalid image: {e}")))?
        {
            RenderedImage::Rasterized(data) | RenderedImage::Sampled { source: data, .. } => data,
        };
        let bitmap = PixmapRef::from_bytes(buffer.data(), buffer.width(), buffer.height())
            .ok_or_else(|| JsError::new("Invalid image: pixel buffer"))?;
        let (sx, sy) = (w / bitmap.width() as f32, h / bitmap.height() as f32);
        let transform = if style.rotate_half_turn {
            Transform::from_row(-sx, 0., 0., -sy, x + w, y + h)
        } else {
            Transform::from_row(sx, 0., 0., sy, x, y)
        };
        let paint = Paint {
            shader: Pattern::new(
                bitmap,
                SpreadMode::Pad,
                FilterQuality::Bilinear,
                1.,
                transform,
            ),
            ..Paint::default()
        };
        let dst = if style.contain {
            Rect::from_xywh(x, y, w, h)
        } else {
            Some(slot)
        };
        if let Some(path) =
            dst.and_then(|r| outline(r, [(radius - style.inset * dpr).max(0.); 4], style.squircle))
        {
            canvas.fill_path(
                &path,
                &paint,
                FillRule::Winding,
                Transform::identity(),
                mask,
            );
        }
    }
    if let Some((width, color)) = style.border {
        let width = width * dpr;
        if let Some(path) = inset(rect, width / 2.)
            .and_then(|r| outline(r, [(radius - width / 2.).max(0.); 4], style.squircle))
        {
            canvas.stroke_path(
                &path,
                &ink(color),
                &Stroke {
                    width,
                    ..Stroke::default()
                },
                Transform::identity(),
                mask,
            );
        }
    }
    Ok(())
}
