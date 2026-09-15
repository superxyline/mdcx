import "./App.css";
import CssBaseline from "@mui/material/CssBaseline";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { client } from "./client/client.gen";
import { ThemeProvider } from "./contexts/ThemeProvider";
import { ToastProvider } from "./contexts/ToastProvider";
import { webSocketManager } from "./hooks/useWebSocket";
import { routeTree } from "./routeTree.gen";
import { type LogEntry, useLogStore } from "./store/logStore";
import { useScrapeStore } from "./store/scrapeStore";

const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// 在应用启动阶段就完成 API 客户端配置.
//
// 子页面组件的 useEffect 会先于根路由执行, 若等到根路由再 setConfig, 页面首次
// 发出的请求(例如刮削页的状态轮询)会因缺少凭据返回 401, 从而触发下面的拦截器
// 误判为 Key 失效并清空本地凭据, 把用户弹回认证页.
//
// 这里无条件设置 baseURL: 生成代码里的默认值是 http://localhost:8000, 从其它
// 设备访问时会错误地指向访问者自己的机器. Key 则可能为空(服务端未启用认证).
client.setConfig({
  baseURL: import.meta.env.PROD ? "" : import.meta.env.PUBLIC_DEV_API_URL,
  auth: localStorage.getItem("apiKey") ?? undefined,
});

// Add interceptor to handle invalid API Key
client.instance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("apiKey");
      router.navigate({ to: "/auth" });
    }
    return Promise.reject(error);
  },
);

// 注册全局 WebSocket 消息处理器
webSocketManager.addHandler<LogEntry>("qt_signal", (_, msg) => {
  useLogStore.getState().addLog(msg);
  // 同一批业务信号也驱动刮削界面的进度、当前文件与结果列表
  useScrapeStore.getState().handleQtSignal(msg);
});

// 进度消息, 对应服务端 ServerSignals._emit_set_processbar
webSocketManager.addHandler<{ progress?: number }>("progress", (data) => {
  if (typeof data?.progress === "number") {
    useScrapeStore.getState().setProgress(data.progress);
  }
});

const App = () => {
  const queryClient = new QueryClient();
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <CssBaseline />
          <RouterProvider router={router} />
          <ReactQueryDevtools />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
};

export default App;
