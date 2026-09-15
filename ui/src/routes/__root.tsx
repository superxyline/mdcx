import { createRootRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { useEffect, useState } from "react";
import { client } from "@/client/client.gen";
import { getWebSocketConnections } from "@/client/sdk.gen";
import { AskDialog } from "@/components/AskDialog";
import { WebSocketProvider } from "@/contexts/WebSocketProvider";
import Layout from "../components/Layout";

export const Route = createRootRoute({
  component: () => {
    const navigate = useNavigate();
    const location = useLocation();
    const apiKey = localStorage.getItem("apiKey");
    const [isValidated, setIsValidated] = useState(false);
    const isAuthPage = location.pathname === "/auth";

    useEffect(() => {
      if (isAuthPage) {
        return;
      }
      // 服务端未设置 MDCX_API_KEY 时不启用认证, 此时浏览器里没有 Key 也能直接用,
      // 因此这里不再要求本地已存在 Key: 先按当前凭据(可能为空)探测一次,
      // 只有确实被服务端拒绝时才跳转到认证页.
      client.setConfig({
        baseURL: import.meta.env.PROD ? "" : import.meta.env.PUBLIC_DEV_API_URL,
        auth: apiKey ?? undefined,
      });
      getWebSocketConnections()
        .then(() => {
          setIsValidated(true);
        })
        .catch((e) => {
          console.error("连接校验失败:", e);
          localStorage.removeItem("apiKey");
          navigate({ to: "/auth", replace: true });
        });
    }, [apiKey, navigate, isAuthPage]);

    console.log(`isValidated: ${isValidated}, isAuthPage: ${isAuthPage}`);
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
