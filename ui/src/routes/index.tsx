/**
 * 刮削主界面.
 *
 * 与桌面版的对应关系:
 * - 进度条/统计数字 ← ``GET /api/v1/scrape/status`` 轮询 + WebSocket progress 消息
 * - 当前处理文件   ← qt_signal:set_label_file_path
 * - 结果列表       ← qt_signal:show_list_name
 *
 * 关键行为: 刮削任务运行在服务端后台线程, 与浏览器连接无关. 因此这里不把
 * WebSocket 当作唯一数据源 —— 页面打开时先拉一次状态, 之后每 2 秒轮询一次,
 * 这样即使用户关闭过浏览器, 回来后看到的统计依然是准确的.
 */

// 图标按路径导入: MUI 9 的 icons-material 包入口是 CJS, 打包器静态分析
// 无法识别全部命名导出, barrel 导入会报 "export not found"
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlined from "@mui/icons-material/ErrorOutlined";
import FolderOpen from "@mui/icons-material/FolderOpen";
import PlayArrow from "@mui/icons-material/PlayArrow";
import Stop from "@mui/icons-material/Stop";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { createFileRoute, Link as RouterLink } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentConfig, getScrapeStatus, startScrape, stopScrape } from "@/client/sdk.gen";
import { useScrapeStore } from "@/store/scrapeStore";

export const Route = createFileRoute("/")({
  component: ScrapePage,
});

/** 把秒数格式化成 1h2m3s 这样的可读形式. */
function formatElapsed(seconds: number): string {
  if (!seconds || seconds < 0) return "0s";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6">{value}</Typography>
    </Stack>
  );
}

function ScrapePage() {
  const running = useScrapeStore((s) => s.running);
  const progress = useScrapeStore((s) => s.progress);
  const total = useScrapeStore((s) => s.total);
  const started = useScrapeStore((s) => s.started);
  const success = useScrapeStore((s) => s.success);
  const failed = useScrapeStore((s) => s.failed);
  const elapsed = useScrapeStore((s) => s.elapsed);
  const currentFile = useScrapeStore((s) => s.currentFile);
  const statusText = useScrapeStore((s) => s.statusText);
  const countText = useScrapeStore((s) => s.countText);
  const results = useScrapeStore((s) => s.results);

  const [mediaPath, setMediaPath] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);

  // 状态轮询: 刷新页面或 WebSocket 断线后仍能拿到准确统计
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getScrapeStatus();
        if (!cancelled && res.data) useScrapeStore.getState().applyStatus(res.data);
      } catch (err) {
        console.error("获取刮削状态失败:", err);
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // 服务端留存了结果明细, 页面打开时补回浏览器关闭期间错过的条目
  useEffect(() => {
    void useScrapeStore.getState().loadHistory();
  }, []);

  useEffect(() => {
    getCurrentConfig()
      .then((res) => setMediaPath(res.data?.media_path ?? ""))
      .catch((err) => console.error("获取配置失败:", err));
  }, []);

  const handleStart = useCallback(async () => {
    setBusy(true);
    try {
      await startScrape();
      useScrapeStore.getState().setRunning(true);
    } catch (err) {
      console.error("启动刮削失败:", err);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setConfirmStop(false);
    setBusy(true);
    try {
      await stopScrape();
    } catch (err) {
      console.error("停止刮削失败:", err);
    } finally {
      setBusy(false);
    }
  }, []);

  const successItems = useMemo(() => results.filter((r) => r.status === "succ"), [results]);
  const failedItems = useMemo(() => results.filter((r) => r.status === "fail"), [results]);
  const listedItems = tab === 0 ? successItems : failedItems;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Card>
        <CardContent>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 2 }}
            flexWrap="wrap"
            gap={2}
          >
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Typography variant="h4">刮削</Typography>
              <Chip
                size="small"
                label={running ? "进行中" : "空闲"}
                color={running ? "primary" : "default"}
                variant={running ? "filled" : "outlined"}
              />
            </Stack>
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" startIcon={<PlayArrow />} disabled={running || busy} onClick={handleStart}>
                开始刮削
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<Stop />}
                disabled={!running || busy}
                onClick={() => setConfirmStop(true)}
              >
                停止
              </Button>
            </Stack>
          </Stack>

          <LinearProgress variant="determinate" value={progress} sx={{ mb: 2 }} />

          <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
            <Stat label="进度" value={`${progress}%`} />
            <Stat label="总数" value={total} />
            <Stat label="已开始" value={started} />
            <Stat label="成功" value={success} />
            <Stat label="失败" value={failed} />
            <Stat label="已用时间" value={formatElapsed(elapsed)} />
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <FolderOpen fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary">
                刮削目录
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {mediaPath || "(未配置)"}
              </Typography>
              <Button size="small" component={RouterLink} to="/settings">
                前往设置
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {statusText}
              {countText ? ` · ${countText}` : ""}
            </Typography>
            {currentFile ? (
              <Typography variant="body2" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>
                {currentFile}
              </Typography>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 1 }}>
            <Tab label={`成功 (${successItems.length})`} />
            <Tab label={`失败 (${failedItems.length})`} />
          </Tabs>
          <Divider />
          {listedItems.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              {tab === 0 ? "暂无成功记录" : "暂无失败记录"}
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 420, overflow: "auto" }}>
              {listedItems.map((item) => (
                <ListItem key={item.id} disableGutters>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {item.status === "succ" ? (
                      <CheckCircleOutlined fontSize="small" color="success" />
                    ) : (
                      <ErrorOutlined fontSize="small" color="error" />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.name}
                    secondary={item.realNumber || undefined}
                    slotProps={{ primary: { variant: "body2" }, secondary: { variant: "caption" } }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmStop} onClose={() => setConfirmStop(false)} maxWidth="xs" fullWidth>
        <DialogTitle>停止刮削</DialogTitle>
        <DialogContent>
          <DialogContentText>确定要停止正在进行的刮削吗？已完成的文件会被保留。</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmStop(false)}>取消</Button>
          <Button variant="contained" color="error" onClick={handleStop}>
            停止刮削
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
