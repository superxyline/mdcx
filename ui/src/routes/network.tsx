import { ContentCopy, OpenInNew, Save } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  getClashStatusApiV1NetworkClashGet as fetchClashStatus,
  updateSubscriptionApiV1NetworkClashSubscriptionPut as putSubscription,
} from "@/client/sdk.gen";
import type { ClashStatus } from "@/client/types.gen";
import { useToast } from "@/contexts/ToastProvider";

export const Route = createFileRoute("/network")({
  component: NetworkComponent,
});

/** 从 hey-api/axios 错误里取出后端返回的 detail 文案. */
function extractDetail(e: unknown, fallback: string): string {
  const body = (e as { body?: { detail?: unknown } })?.body;
  if (typeof body?.detail === "string") return body.detail;
  const data = (e as { response?: { data?: { detail?: unknown } } })?.response?.data;
  if (typeof data?.detail === "string") return data.detail;
  return fallback;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function NetworkComponent() {
  const { showSuccess, showError } = useToast();
  const [status, setStatus] = useState<ClashStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [url, setUrl] = useState("");
  const [hours, setHours] = useState("1");

  const load = useCallback(async () => {
    try {
      const res = await fetchClashStatus({ throwOnError: true });
      const data = res.data;
      setStatus(data ?? null);
      if (data) {
        setUrl(data.subscription_url ?? "");
        setHours(String(data.update_interval_hours ?? 1));
      }
    } catch (e) {
      showError(extractDetail(e, "读取 Clash 状态失败"));
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      showError("请填写订阅地址");
      return;
    }
    setSaving(true);
    try {
      const res = await putSubscription({
        body: { url: trimmed, update_interval_hours: Number(hours) || 1 },
        throwOnError: true,
      });
      const data = res.data;
      setStatus(data ?? null);
      if (data) {
        setUrl(data.subscription_url ?? trimmed);
        setHours(String(data.update_interval_hours ?? hours));
      }
      showSuccess("订阅已保存, 内核已重载");
    } catch (e) {
      showError(extractDetail(e, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const openPanel = () => {
    window.open(`http://${window.location.hostname}:9090/ui`, "_blank");
  };

  const copySecret = async () => {
    if (!status?.panel_secret) return;
    try {
      await navigator.clipboard.writeText(status.panel_secret);
      showSuccess("面板密码已复制");
    } catch {
      showError("复制失败, 请手动选择文本复制");
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8, gap: 1 }}>
        <CircularProgress size={32} />
        <Typography color="text.secondary">正在读取内核状态…</Typography>
      </Stack>
    );
  }

  const kernelOnline = status?.kernel_reachable ?? false;
  const configMissing = Boolean(status && !status.config_available);

  return (
    <Box sx={{ maxWidth: 800 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        网络
      </Typography>

      {configMissing ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          未读到 Clash 配置文件。若已启用自带的 clash 容器, 请在 docker-compose.yml 的 mdcx 服务 volumes 里确认存在{" "}
          <code>- ./clash:/clash-config</code> 挂载后重建容器。
        </Alert>
      ) : null}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Clash 代理内核
          </Typography>
          <Chip
            size="small"
            color={kernelOnline ? "success" : "error"}
            label={kernelOnline ? `内核在线${status?.kernel_version ? ` · ${status.kernel_version}` : ""}` : "内核离线"}
          />
          <Button size="small" variant="outlined" endIcon={<OpenInNew />} onClick={openPanel} disabled={configMissing}>
            打开面板
          </Button>
        </Stack>
        {!kernelOnline && status?.kernel_error ? (
          <Typography variant="caption" color="error" sx={{ display: "block", mb: 1 }}>
            {status.kernel_error}
          </Typography>
        ) : null}
        {status?.panel_secret ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              面板密码:
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: "monospace", userSelect: "all" }}>
              {status.panel_secret}
            </Typography>
            <Tooltip title="复制密码">
              <IconButton size="small" onClick={copySecret}>
                <ContentCopy fontSize="inherit" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null}

        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={1} sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1}>
            <Chip
              size="small"
              variant="outlined"
              label={status?.provider_proxies_count != null ? `${status.provider_proxies_count} 个节点` : "节点数未知"}
            />
            <Chip size="small" variant="outlined" label={`订阅上次更新: ${formatTime(status?.provider_updated_at)}`} />
          </Stack>
          {status?.provider_error ? (
            <Typography variant="caption" color="warning.main">
              {status.provider_error}
            </Typography>
          ) : null}
        </Stack>

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          订阅设置
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="订阅地址"
            size="small"
            fullWidth
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/your-subscription"
            disabled={saving || configMissing}
            helperText="保存后自动写入配置并重载内核, 无需手工编辑文件"
          />
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <TextField
              label="自动更新间隔(小时)"
              size="small"
              type="number"
              sx={{ width: 200 }}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              inputProps={{ min: 0.1, step: 0.5 }}
              disabled={saving || configMissing}
            />
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              disabled={saving || configMissing || !url.trim()}
              sx={{ mt: 0.5 }}
            >
              {saving ? "保存并重载中…" : "保存并应用"}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          mdcx 使用的代理
        </Typography>
        <Typography variant="body2" color="text.secondary">
          在 设置 → 代理与网络 中填写 <code>http://mdcx-clash:7890</code>(仅 Docker 部署且保留了 clash 容器时可用,{" "}
          <strong>不能填 127.0.0.1</strong>)。节点选择、规则等细项请在上方「打开面板」里操作。
        </Typography>
      </Paper>
    </Box>
  );
}
