use js_sys::Function;
use ruyo_layout::{BoxPaint, DisplayList, Run, measure};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn layout(
    title: &str,
    channel: &str,
    width: f32,
    height_ratio: f32,
    prepare: &Function,
) -> Result<JsValue, JsValue> {
    let mut list = DisplayList::default();
    let inset = if width >= 400. { 20. } else { 12. };
    let inner = width - 2. * inset;
    // Portrait videos sit in a square player frame, cropped to their own ratio so letterboxing disappears.
    let cover_height = (inner * height_ratio.min(1.)).round();
    if height_ratio > 1. {
        list.rect(
            inset,
            inset,
            inner,
            cover_height,
            BoxPaint::solid([15, 15, 15, 255], 12.),
        );
        let w = cover_height / height_ratio;
        list.image(
            "cover",
            inset + (inner - w) / 2.,
            inset,
            w,
            cover_height,
            BoxPaint::default(),
        );
    } else {
        list.image(
            "cover",
            inset,
            inset,
            inner,
            cover_height,
            BoxPaint::rounded(12.),
        );
    }

    let title = measure(
        prepare,
        vec![Run::plain(title)],
        "font-family:system-ui,sans-serif;font-size:18px;font-weight:600;line-height:24px;color:#0f0f0f;overflow-wrap:anywhere".into(),
        inner,
        None,
    )?;
    let y = inset + cover_height + 12.;
    list.text(inset, y, title);
    let y = y + title.height + 6.;
    let channel = measure(
        prepare,
        vec![Run::plain(channel)],
        "font-family:system-ui,sans-serif;font-size:14px;line-height:20px;color:#606060;overflow-wrap:anywhere".into(),
        inner - 26.,
        None,
    )?;
    list.svg(inset, y, 20., r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20"><rect x="0" y="3" width="20" height="14" rx="4" fill="#ff0033"/><path d="M8 6.5v7l6-3.5z" fill="white"/></svg>"##.into());
    list.text(inset + 26., y, channel);
    list.finish(y + channel.height.max(20.) + inset)
}
