import asyncio
import traceback
from pathlib import Path

from PIL import Image, ImageFilter

from .signals import signal


def cut_pic(pic_path: Path):
    # 打开图片, 获取图片尺寸
    img = None
    img_new = None
    img_new_png = None
    try:
        img = Image.open(pic_path)  # 返回一个Image对象

        w, h = img.size
        prop = h / w

        # 判断裁剪方式
        if prop < 1.4:  # 胖，裁剪左右
            ax = int((w - h / 1.5) / 2)
            ay = 0
            bx = int(ax + h / 1.5)
            by = int(h)
        elif prop > 1.6:  # 瘦，裁剪上下
            ax = 0
            ay = int((h - 1.5 * w) / 2)
            bx = int(w)
            by = int(h - ay)
        else:
            img.close()
            return

        # 裁剪并保存
        img_new = img.convert("RGB")
        img_new_png = img_new.crop((ax, ay, bx, by))
        img_new_png.save(pic_path, quality=95, subsampling=0)
    except Exception:
        signal.show_traceback_log(traceback.format_exc())
        signal.show_log_text(traceback.format_exc())
    finally:
        if img_new_png:
            img_new_png.close()
        if img_new:
            img_new.close()
        if img:
            img.close()


async def fix_pic_async(pic_path: Path, new_path: Path):
    await asyncio.to_thread(fix_pic, pic_path, new_path)


def fix_pic(pic_path: Path, new_path: Path):
    pic = None
    fixed_pic = None
    try:
        pic = Image.open(pic_path)
        (w, h) = pic.size
        prop = w / h
        if prop < 1.156:  # 左右居中
            backdrop_w = int(1.156 * h)  # 背景宽度
            backdrop_h = int(h)  # 背景宽度
            foreground_x = int((backdrop_w - w) / 2)  # 前景x点
            foreground_y = 0  # 前景y点
        else:  # 下面对齐
            ax, ay, bx, by = int(w * 0.0155), int(h * 0.0888), int(w * 0.9833), int(h * 0.9955)
            pic_new = pic.convert("RGB")
            pic = pic_new.crop((ax, ay, bx, by))
            backdrop_w = bx - ax
            backdrop_h = int((bx - ax) / 1.156)
            foreground_x = 0
            foreground_y = int(backdrop_h - (by - ay))
        fixed_pic = pic.resize((backdrop_w, backdrop_h))  # 背景拉伸
        fixed_pic = fixed_pic.filter(ImageFilter.GaussianBlur(radius=50))  # 背景高斯模糊
        fixed_pic.paste(pic, (foreground_x, foreground_y))  # 粘贴原图
        fixed_pic = fixed_pic.convert("RGB")
        fixed_pic.save(new_path, quality=95, subsampling=0)
    except Exception:
        signal.show_log_text(f"{traceback.format_exc()}\n Pic: {pic_path}")
        signal.show_traceback_log(traceback.format_exc())
    finally:
        if pic is not None:
            pic.close()
        if fixed_pic is not None:
            fixed_pic.close()
