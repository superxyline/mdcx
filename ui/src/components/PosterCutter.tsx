/**
 * 封面裁剪对话框.
 *
 * 沿用桌面版的交互方式: 一个固定高宽比的裁剪框叠在图片上, 拖动它选择位置,
 * 用滑块微调高宽比. 裁剪后只有 poster 被替换, thumb 与 fanart 保留原图,
 * 与桌面版一致.
 *
 * 图片用 fetch 取回再转成 blob URL —— img 标签无法携带 X-API-KEY 请求头,
 * 在开启认证的部署里直接写 src 会拿到 401.
 */

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Slider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { client } from "@/client/client.gen";
import { cutPoster, getPosterInfo } from "@/client/sdk.gen";
import type { PosterInfo } from "@/client/types.gen";
import { useToast } from "@/contexts/ToastProvider";

/** 桌面版裁剪框的默认高宽比 536.6/379. */
const DEFAULT_RATIO = 1.42;
/** 图片显示区域的最大高度 */
const MAX_DISPLAY_HEIGHT = 420;

const MARK_OPTIONS = ["4K", "8K", "字幕", "有码", "破解", "流出", "无码"];

/** 依据可用显示区域与目标高宽比, 算出裁剪框的显示尺寸. */
function calcBox(displayW: number, displayH: number, ratio: number) {
  if (displayH / displayW <= ratio) {
    // 图片相对更宽, 高度撑满
    const h = displayH;
    return { w: h / ratio, h };
  }
  const w = displayW;
  return { w, h: w * ratio };
}

interface PosterCutterProps {
  open: boolean;
  onClose: () => void;
  /** 外部带入的图片路径 (如从刮削结果详情跳转), 打开时自动载入 */
  initialPath?: string;
}

export function PosterCutter({ open, onClose, initialPath }: PosterCutterProps) {
  const { showSuccess, showError } = useToast();

  const [path, setPath] = useState("");
  const [info, setInfo] = useState<PosterInfo | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [marks, setMarks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [display, setDisplay] = useState({ w: 0, h: 0 });

  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const urlRef = useRef<string | null>(null);

  // 关闭时释放 blob URL, 避免内存泄漏
  useEffect(() => {
    if (open) return;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setImageUrl(null);
    setInfo(null);
    setPath("");
  }, [open]);

  const loadImage = async (targetArg?: string) => {
    const target = (targetArg ?? path).trim();
    if (!target) {
      showError("请先输入图片路径");
      return;
    }
    setBusy(true);
    try {
      const res = await getPosterInfo({ query: { path: target } });
      const data = res.data;
      if (!data) throw new Error("未获取到图片信息");
      setInfo(data);

      const img = await client.instance.get("/api/v1/tools/poster/image", {
        params: { path: data.path },
        responseType: "blob",
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(img.data as Blob);
      setImageUrl(urlRef.current);

      // 依据番号信息预勾选水印
      const preset: string[] = [];
      if (data.definition === "4K" || data.definition === "UHD") preset.push("4K");
      else if (data.definition === "8K" || data.definition === "UHD8") preset.push("8K");
      if (data.has_sub) preset.push("字幕");
      if (data.mosaic === "有码" || data.mosaic === "有碼") preset.push("有码");
      else if (data.mosaic?.includes("破解")) preset.push("破解");
      else if (data.mosaic?.includes("流出")) preset.push("流出");
      else if (data.mosaic === "无码" || data.mosaic === "無碼") preset.push("无码");
      setMarks(preset);
    } catch (err) {
      showError(`加载失败: ${err}`);
      setInfo(null);
      setImageUrl(null);
    } finally {
      setBusy(false);
    }
  };

  const handleImageLoad = () => {
    const el = imgRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setDisplay({ w, h });
    const size = calcBox(w, h, ratio);
    setBox({ x: Math.max(0, (w - size.w) / 2), y: Math.max(0, (h - size.h) / 2), ...size });
  };

  // 外部带入图片路径时自动载入; ref 防止依赖变化导致重复加载
  const loadedInitialRef = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadImage 每次渲染重建, 只需随 open/initialPath 触发
  useEffect(() => {
    if (!open || !initialPath || loadedInitialRef.current === initialPath) return;
    loadedInitialRef.current = initialPath;
    setPath(initialPath);
    void loadImage(initialPath);
  }, [open, initialPath]);

  // 调整比例时保持左上角不动, 仅重算尺寸并夹回边界内
  useEffect(() => {
    if (!display.w || !display.h) return;
    const size = calcBox(display.w, display.h, ratio);
    setBox((prev) => ({
      ...size,
      x: Math.max(0, Math.min(prev.x, display.w - size.w)),
      y: Math.max(0, Math.min(prev.y, display.h - size.h)),
    }));
  }, [ratio, display]);

  // 拖动裁剪框
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setBox((prev) => ({
        ...prev,
        x: Math.max(0, Math.min(display.w - prev.w, drag.origX + (e.clientX - drag.startX))),
        y: Math.max(0, Math.min(display.h - prev.h, drag.origY + (e.clientY - drag.startY))),
      }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [display]);

  const handleCut = async () => {
    if (!info || !display.w) return;
    // 显示坐标换算回原图坐标: 图片等比缩放, 宽高用同一个系数
    const scale = info.width / display.w;
    const box_coords: [number, number, number, number] = [
      Math.round(box.x * scale),
      Math.round(box.y * scale),
      Math.round((box.x + box.w) * scale),
      Math.round((box.y + box.h) * scale),
    ];
    setBusy(true);
    try {
      const res = await cutPoster({ body: { path: info.path, box: box_coords, marks } });
      showSuccess(res.data?.message ?? "裁剪完成");
      onClose();
    } catch (err) {
      showError(`裁剪失败: ${err}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleMark = (mark: string, checked: boolean) => {
    setMarks((prev) => (checked ? [...prev, mark] : prev.filter((m) => m !== mark)));
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>封面裁剪</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack direction="row" spacing={1}>
            <TextField
              label="封面图片路径"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              size="small"
              fullWidth
              placeholder="例如 /media/ABP-123/ABP-123-poster.jpg"
            />
            <Button variant="outlined" onClick={loadImage} disabled={busy} sx={{ whiteSpace: "nowrap" }}>
              {busy ? "加载中..." : "加载"}
            </Button>
          </Stack>

          {imageUrl ? (
            <Box sx={{ position: "relative", alignSelf: "flex-start", userSelect: "none" }}>
              <img
                ref={imgRef}
                src={imageUrl}
                alt="待裁剪封面"
                onLoad={handleImageLoad}
                style={{ display: "block", maxWidth: "100%", maxHeight: MAX_DISPLAY_HEIGHT }}
              />
              <Box
                onMouseDown={(e) => {
                  e.preventDefault();
                  dragRef.current = { startX: e.clientX, startY: e.clientY, origX: box.x, origY: box.y };
                }}
                sx={{
                  position: "absolute",
                  left: `${box.x}px`,
                  top: `${box.y}px`,
                  width: `${box.w}px`,
                  height: `${box.h}px`,
                  border: "2px solid",
                  borderColor: "primary.main",
                  bgcolor: "rgba(200, 200, 200, 0.3)",
                  cursor: "move",
                  boxSizing: "border-box",
                }}
              />
            </Box>
          ) : (
            <Alert severity="info">输入封面图片路径后点「加载」，然后拖动蓝色框选择裁剪范围。</Alert>
          )}

          <Box>
            <Typography variant="body2" color="text.secondary">
              裁剪框高宽比: {ratio.toFixed(2)}（拖动上方滑块微调）
            </Typography>
            <Slider
              value={ratio}
              min={0.8}
              max={3}
              step={0.01}
              onChange={(_, v) => setRatio(v as number)}
              disabled={!imageUrl}
            />
          </Box>

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              叠加水印
            </Typography>
            <Stack direction="row" flexWrap="wrap">
              {MARK_OPTIONS.map((mark) => (
                <FormControlLabel
                  key={mark}
                  control={
                    <Checkbox
                      size="small"
                      checked={marks.includes(mark)}
                      onChange={(e) => toggleMark(mark, e.target.checked)}
                    />
                  }
                  label={mark}
                />
              ))}
            </Stack>
          </Box>

          {info ? (
            <Typography variant="caption" color="text.secondary">
              原图 {info.width}×{info.height} · 番号 {info.number || "未识别"} · 输出 {info.poster_path}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleCut} disabled={!info || busy}>
          {busy ? "处理中..." : "裁剪"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
