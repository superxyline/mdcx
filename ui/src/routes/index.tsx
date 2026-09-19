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
import CloudSyncOutlined from "@mui/icons-material/CloudSyncOutlined";
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
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link as RouterLink } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  backfillHistoryMutation,
  getCurrentConfigOptions,
  retryFailedListMutation,
} from "@/client/@tanstack/react-query.gen";
import { getScrapeStatus, startScrape, stopScrape } from "@/client/sdk.gen";
import { PosterThumb, ResultDetailDialog } from "@/components/ResultDetail";
import { WizardDialog } from "@/components/WizardDialog";
import { useToast } from "@/contexts/ToastProvider";
import { type ScrapeListItem, useScrapeStore } from "@/store/scrapeStore";

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

/** 结果条目的记录时间. */
function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
  const failedDetails = useScrapeStore((s) => s.failedDetails);
  const timedEnabled = useScrapeStore((s) => s.timedEnabled);
  const timedNextRun = useScrapeStore((s) => s.timedNextRun);
  const { showSuccess, showError } = useToast();

  const [mediaPath, setMediaPath] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<ScrapeListItem | null>(null);

  // 从媒体库导入历史刮削记录 (NFO 扫描回填)
  const backfillMut = useMutation(backfillHistoryMutation());
  // 失败列表一键重试 (后端把失败文件作为待刮清单重新提交)
  const retryMut = useMutation(retryFailedListMutation());

  // 配置: 既用于展示刮削目录, 也用于判断是否弹出首次使用向导
  const configQ = useQuery(getCurrentConfigOptions());
  useEffect(() => {
    if (configQ.data) setMediaPath(configQ.data.media_path ?? "");
  }, [configQ.data]);

  // 只在向导未完成时弹一次; 完成/跳过后 wizard_done 会持久化为 true
  useEffect(() => {
    if (configQ.isSuccess && configQ.data?.wizard_done === false) {
      setWizardOpen(true);
    }
  }, [configQ.isSuccess, configQ.data]);

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

  const handleRetryFailed = useCallback(() => {
    retryMut.mutate(undefined, {
      onSuccess: (res) => {
        showSuccess(res.data?.message ?? "已提交重新刮削");
        useScrapeStore.getState().setRunning(true);
      },
      onError: (err) => showError(`重试失败: ${err}`),
    });
  }, [retryMut, showSuccess, showError]);

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
            {timedEnabled && timedNextRun > 0 && !running && (
              <Typography variant="body2" color="text.secondary">
                ⏰ 定时刮削已开启 · 下次 {formatTime(timedNextRun)}
              </Typography>
            )}
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
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flexGrow: 1 }}>
              <Tab label={`成功 (${successItems.length})`} />
              <Tab label={`失败 (${failedItems.length})`} />
            </Tabs>
            {tab === 1 && (
              <Button
                size="small"
                variant="outlined"
                color="warning"
                disabled={running || retryMut.isPending || failedItems.length === 0}
                onClick={handleRetryFailed}
                sx={{ mr: 1 }}
              >
                {retryMut.isPending ? "提交中..." : `重试失败 (${failedItems.length})`}
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              startIcon={<CloudSyncOutlined />}
              disabled={backfillMut.isPending}
              onClick={() =>
                backfillMut.mutate(undefined, {
                  onSuccess: (res) => {
                    if (res.data) {
                      if (res.data.imported > 0) {
                        showSuccess(`已从媒体库导入 ${res.data.imported} 条历史记录`);
                      } else {
                        showSuccess(`没有新记录 (扫描到 ${res.data.scanned} 个 NFO)`);
                      }
                    }
                    void useScrapeStore.getState().loadHistory();
                  },
                  onError: (err) => showError(`导入失败: ${err}`),
                })
              }
            >
              {backfillMut.isPending ? "扫描中..." : "导入历史"}
            </Button>
          </Stack>
          <Divider />
          {listedItems.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: "center" }}>
              {tab === 0 ? "暂无成功记录, 点右上角「导入历史」可找回之前刮削过的影片" : "暂无失败记录"}
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 420, overflow: "auto" }}>
              {listedItems.map((item) => (
                <ListItemButton key={item.id} disableGutters onClick={() => setDetailItem(item)}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {item.status === "succ" ? (
                      <CheckCircleOutlined fontSize="small" color="success" />
                    ) : (
                      <ErrorOutlined fontSize="small" color="error" />
                    )}
                  </ListItemIcon>
                  {item.detail?.poster_path && <PosterThumb path={item.detail.poster_path} height={56} />}
                  <ListItemText
                    primary={item.name}
                    secondary={
                      item.realNumber || item.ts
                        ? [item.realNumber, item.ts ? formatTime(item.ts) : ""].filter(Boolean).join(" · ")
                        : undefined
                    }
                    slotProps={{ primary: { variant: "body2" }, secondary: { variant: "caption" } }}
                    sx={{ ml: 1 }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
          {tab === 1 && failedDetails.length > 0 && (
            <Box sx={{ mt: 1, maxHeight: 160, overflow: "auto" }}>
              {failedDetails.map((fd) => (
                <Typography
                  key={fd.id}
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                >
                  {fd.text}
                </Typography>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      <ResultDetailDialog item={detailItem} onClose={() => setDetailItem(null)} />

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

      {configQ.data && <WizardDialog open={wizardOpen} config={configQ.data} onClose={() => setWizardOpen(false)} />}
    </Box>
  );
}
