import ImageNotSupportedOutlined from "@mui/icons-material/ImageNotSupportedOutlined";
import OpenInNew from "@mui/icons-material/OpenInNew";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { client } from "@/client/client.gen";
import { authHeaders } from "@/lib/apiKey";
import type { ScrapeListItem } from "@/store/scrapeStore";

/**
 * 刮削结果预览.
 *
 * 图片走 fetch 取回再转 blob URL —— img 标签无法携带 X-API-KEY 请求头,
 * 直接写 src 在开启认证时会 401 (与 PosterCutter 同一套做法).
 */

function useImageBlobUrl(path: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    (async () => {
      try {
        const res = await client.instance.get("/api/v1/tools/poster/image", {
          // 裸 axios 实例不读取 setConfig 设置的 baseURL, 必须显式传入,
          // 否则会落到生成代码里的 http://localhost:8000, 其它设备访问时取不到图
          baseURL: client.getConfig().baseURL ?? "",
          // 裸调用不经过 hey-api 的 security 注入, Key 必须手动带头
          headers: authHeaders(),
          params: { path },
          responseType: "blob",
        });
        if (cancelled) return;
        const objUrl = URL.createObjectURL(res.data as Blob);
        urlRef.current = objUrl;
        setUrl(objUrl);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [path]);

  return url;
}

const FALLBACK_POSTER = (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      bgcolor: "action.hover",
      borderRadius: 1,
      color: "text.disabled",
    }}
  >
    <ImageNotSupportedOutlined />
  </Box>
);

/** 列表缩略图 (竖版海报) */
export function PosterThumb({ path, height = 64 }: { path?: string; height?: number }) {
  const url = useImageBlobUrl(path);
  if (!path || !url) {
    return <Box sx={{ width: (height * 2) / 3, height, flexShrink: 0 }}>{FALLBACK_POSTER}</Box>;
  }
  return (
    <Box
      component="img"
      src={url}
      alt=""
      sx={{
        width: "auto",
        height,
        maxWidth: (height * 2) / 3 + 24,
        borderRadius: 1,
        objectFit: "cover",
        flexShrink: 0,
      }}
    />
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Stack direction="row" spacing={1.5}>
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
        {value}
      </Typography>
    </Stack>
  );
}

/** 结果条目详情弹窗: 封面大图 + 元数据 + 文件位置 */
export function ResultDetailDialog({ item, onClose }: { item: ScrapeListItem | null; onClose: () => void }) {
  const detail = item?.detail;
  const imagePath = detail?.poster_path || detail?.fanart_path;
  const url = useImageBlobUrl(item ? imagePath : undefined);

  return (
    <Dialog open={!!item} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {item?.name}
        {detail?.mosaic && <Chip size="small" label={detail.mosaic} variant="outlined" />}
      </DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={2.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
          <Box sx={{ width: 240, minHeight: 200 }}>
            {url ? (
              <Box component="img" src={url} alt="" sx={{ width: "100%", borderRadius: 1 }} />
            ) : (
              <Box sx={{ width: 240, height: 340 }}>{FALLBACK_POSTER}</Box>
            )}
          </Box>
          <Stack spacing={1.2} sx={{ flexGrow: 1, minWidth: 260 }}>
            {detail ? (
              <>
                {detail.title && detail.title !== item?.name && <Typography variant="body1">{detail.title}</Typography>}
                <Field label="番号" value={detail.number || item?.realNumber} />
                <Field label="演员" value={detail.actors} />
                <Field label="发行日期" value={detail.release} />
                <Divider sx={{ my: 0.5 }} />
                <Field label="影片文件" value={detail.file_path} />
                <Field label="所在目录" value={detail.folder_path} />
                <Field label="NFO" value={detail.nfo_path} />
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                这条记录没有详细元数据 (较早期的历史记录只有番号), 可以重新刮削或导入后查看.
              </Typography>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        {detail?.poster_path && (
          <RouterLink
            to="/tool"
            search={{ cutterPath: detail.poster_path }}
            onClick={onClose}
            style={{ textDecoration: "none", marginRight: "auto" }}
          >
            <Button startIcon={<OpenInNew />}>在工具箱中裁剪封面</Button>
          </RouterLink>
        )}
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}
