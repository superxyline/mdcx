import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect, useState } from "react";
import { AskDialog } from "@/components/AskDialog";
import { WebSocketProvider } from "@/contexts/WebSocketProvider";
import { applyApiKey, clearStoredApiKey, getStoredApiKey } from "@/lib/apiKey";
import Layout from "../components/Layout";

export const Route = createRootRoute({
  component: () => {
    const navigate = useNavigate();
    const location = useLocation();
    // 每次渲染读取, 保证认证页保存 Key 后跳回时能拿到最新值
    const apiKey = getStoredApiKey();
    const [isValidated, setIsValidated] = useState(false);
    const isAuthPage = location.pathname === "/auth";

    useEffect(() => {
      if (isAuthPage) {
        applyApiKey(getStoredApiKey());
        return;
      }
      // 服务端未设置 MDCX_API_KEY 时不启用认证, 此时浏览器里没有 Key 也能直接用.
      // 必须 throwOnError, 否则 401 被当成成功, 校验形同虚设.
      applyApiKey(apiKey);
      let cancelled = false;
      import("@/client/sdk.gen")
        .then(({ getScrapeStatus }) => getScrapeStatus({ throwOnError: true }))
        .then(() => {
          if (!cancelled) setIsValidated(true);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const status =
            (e as { response?: { status?: number }; status?: number })?.response?.status ??
            (e as { status?: number })?.status;
          console.error("连接校验失败:", e);
          // 只有明确 401 才清 Key 并回认证页; 网络抖动不应把用户已保存的 Key 抹掉
          if (status === 401) {
            clearStoredApiKey();
            applyApiKey(null);
            navigate({ to: "/auth", replace: true });
          } else {
            setIsValidated(true);
          }
        });
      return () => {
        cancelled = true;
      };
    }, [apiKey, navigate, isAuthPage]);

    if (isAuthPage) return <Outlet />;

    return (
      <>
        <Layout>
          <WebSocketProvider>
            <Outlet />
          </WebSocketProvider>
          {/* 服务端在后台等待用户决策时弹出的对话框, 需挂在路由内部以便 API 已配置 */}
          <AskDialog />
        </Layout>
        <TanStackRouterDevtools />
      </>
    );
  },
});
