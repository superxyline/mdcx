/**
 * 客户端 API Key 存取与 X-API-KEY 注入.
 *
 * 放在 client.gen 旁路初始化: 页面一加载就把 localStorage 里的 Key 写进
 * hey-api client, 避免「根路由 effect 还没跑, Layout/首页已发请求」的时序问题.
 */

import { client } from "@/client/client.gen";

export const API_KEY_STORAGE = "apiKey";

export function getStoredApiKey(): string | null {
  try {
    return localStorage.getItem(API_KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function clearStoredApiKey(): void {
  try {
    localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

/** 裸 axios 请求手动带上认证头 (绕过了 hey-api 的 security 注入时用). */
export function authHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  return key ? { "X-API-KEY": key } : {};
}

export function applyApiKey(key: string | null | undefined): void {
  client.setConfig({
    baseURL: import.meta.env.PROD ? "" : import.meta.env.PUBLIC_DEV_API_URL,
    auth: key || undefined,
  });
}

/** 模块加载时立即应用已保存的 Key, 使首个请求就带上认证头. */
applyApiKey(getStoredApiKey());

/** 判断 hey-api 在 throwOnError:false 时返回的对象是否实为 HTTP 错误. */
export function isApiFailure(result: unknown): result is { status?: number; response?: { status?: number } } {
  if (!result || typeof result !== "object") return false;
  const r = result as { response?: { status?: number }; status?: number; error?: unknown };
  if (r.response) return true;
  // 成功响应带 data/error 字段区分; AxiosError 无正常 data
  if (r.error !== undefined && r.response === undefined && "stack" in r) return true;
  return typeof r.status === "number" && r.status >= 400;
}

export function apiStatus(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { response?: { status?: number }; status?: number };
  return r.response?.status ?? r.status;
}

/**
 * 探测服务端是否接受当前凭据.
 * - 200 → { ok: true, authEnabled: boolean }
 * - 401 → { ok: false, unauthorized: true }
 * - 其它错误 → { ok: false, unauthorized: false } (网络问题时不要清 Key)
 */
export async function probeAuth(): Promise<
  { ok: true; authEnabled: boolean } | { ok: false; unauthorized: boolean; status?: number }
> {
  const { getScrapeStatus } = await import("@/client/sdk.gen");
  const res = await getScrapeStatus({ throwOnError: true });
  const authEnabled = Boolean(res.data?.auth_enabled);
  return { ok: true, authEnabled };
}
