use super::{Stat, stat_footer, text};
use js_sys::Function;
use ruyo_layout::{BoxPaint, DisplayList, Run};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[derive(Deserialize)]
pub(super) struct VideoPreview {
    title: String,
    cover: String,
    duration: Option<String>,
    meta: Option<String>,
}

impl VideoPreview {
    pub(super) fn draw(
        &self,
        list: &mut DisplayList,
        prepare: &Function,
        x: f32,
        y: f32,
        width: f32,
    ) -> Result<f32, JsValue> {
        let height = (width * 9. / 16.).round();
        list.image(&self.cover, x, y, width, height, BoxPaint::rounded(8.));
        if let Some(duration) = self.duration.as_ref().filter(|d| !d.is_empty()) {
            let label = text(
                prepare,
                vec![Run::plain(duration)],
                width - 20.,
                "font-size:13px;color:white;line-height:18px",
            )?;
            let right = x + width - 8.;
            let bottom = y + height - 8.;
            list.rect(
                right - label.width - 10.,
                bottom - label.height - 4.,
                label.width + 10.,
                label.height + 4.,
                BoxPaint::solid([0, 0, 0, 180], 4.),
            );
            list.text(right - label.width - 5., bottom - label.height - 2., label);
        }
        let title = text(
            prepare,
            vec![Run::plain(&self.title)],
            width,
            "font-size:20px;line-height:28px;font-weight:600;overflow-wrap:anywhere",
        )?;
        let mut y = y + height + 10.;
        list.text(x, y, title);
        y += title.height;
        if let Some(meta) = self.meta.as_ref().filter(|m| !m.is_empty()) {
            let block = text(
                prepare,
                vec![Run::plain(meta)],
                width,
                "font-size:13px;color:#9499a0;line-height:18px;overflow-wrap:anywhere",
            )?;
            y += 5.;
            list.text(x, y, block);
            y += block.height;
        }
        Ok(y)
    }
}

#[derive(Deserialize)]
struct VideoCard {
    video: VideoPreview,
    part: Option<String>,
    name: String,
    avatar: Option<String>,
    date: Option<String>,
    stats: Vec<Stat>,
}

#[wasm_bindgen(js_name = videoLayout)]
pub fn video_layout(content: JsValue, width: u32, prepare: &Function) -> Result<JsValue, JsValue> {
    let card: VideoCard = serde_wasm_bindgen::from_value(content)?;
    let width = width as f32;
    let inset = if width >= 400. { 20. } else { 12. };
    let inner = width - 2. * inset;
    let mut list = DisplayList::default();
    let mut y = card.video.draw(&mut list, prepare, inset, inset, inner)?;
    if let Some(part) = card.part {
        let block = text(
            prepare,
            vec![Run::plain(part)],
            inner,
            "color:#008ac5;font-size:14px;line-height:20px;overflow-wrap:anywhere",
        )?;
        y += 6.;
        list.text(inset, y, block);
        y += block.height;
    }
    y += 14.;
    let mut x = inset;
    if let Some(avatar) = card.avatar {
        list.image(&avatar, x, y, 36., 36., BoxPaint::rounded(18.));
        x += 44.;
    }
    let available = width - inset - x;
    let name = text(
        prepare,
        vec![Run::plain(card.name)],
        available,
        "font-size:15px;font-weight:600;line-height:20px;overflow-wrap:anywhere",
    )?;
    list.text(x, y, name);
    let mut author_height = name.height;
    if let Some(date) = card.date {
        let block = text(
            prepare,
            vec![Run::plain(date)],
            available,
            "color:#9499a0;font-size:12px;line-height:16px",
        )?;
        list.text(x, y + author_height, block);
        author_height += block.height;
    }
    let h = stat_footer(
        &mut list,
        prepare,
        &card.stats,
        inset,
        inner,
        y + author_height.max(36.),
    )?;
    list.finish(h)
}
