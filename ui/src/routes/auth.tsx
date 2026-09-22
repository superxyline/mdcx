import { Alert, Box, Button, TextField, Typography } from "@mui/material";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { applyApiKey, clearStoredApiKey, setStoredApiKey } from "@/lib/apiKey";

export const Route = createFileRoute("/auth")({
  component: Auth,
});

function Auth() {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!inputValue.trim()) return;
    setLoading(true);
    setError(null);

    const key = inputValue.trim();
    try {
      applyApiKey(key);
      // throwOnError: 401 必须 reject, 否则 hey-api 会把错误当成功返回
      const { getScrapeStatus } = await import("@/client/sdk.gen");
      await getScrapeStatus({ throwOnError: true });
      setStoredApiKey(key);
      applyApiKey(key);
      // 不用 history.back(): 重定向进来的历史栈里上一页可能还是 /auth
      navigate({ to: "/", replace: true });
    } catch (e) {
      clearStoredApiKey();
      applyApiKey(null);
      const status =
        (e as { response?: { status?: number }; status?: number })?.response?.status ??
        (e as { status?: number })?.status;
      if (status === 401) {
        setError("API Key 无效，请核对后重试。");
      } else {
        setError("网络错误或服务器不可用，请稍后重试。");
      }
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "80vh",
        gap: 2,
        p: 3,
      }}
    >
      <Typography variant="h5" gutterBottom>
        请输入 API Key
      </Typography>
      <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 2, maxWidth: "400px" }}>
        此 Key 需与服务器环境变量 MDCX_API_KEY 一致. NAS 部署的 Key 保存在{" "}
        <Typography component="span" sx={{ fontFamily: "monospace" }}>
          E:\codex\tools\mdcx_api_key.txt
        </Typography>
        .
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 2, width: "100%", maxWidth: "400px" }}>
          {error}
        </Alert>
      )}
      <TextField
        label="API Key"
        variant="outlined"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        sx={{ width: "100%", maxWidth: "400px" }}
        disabled={loading}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSave();
          }
        }}
      />
      <Button variant="contained" onClick={handleSave} sx={{ mt: 2 }} disabled={loading || !inputValue.trim()}>
        {loading ? "验证中..." : "保存并继续"}
      </Button>
    </Box>
  );
}
