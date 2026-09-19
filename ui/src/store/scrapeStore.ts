/**
 * 刮削状态 store.
 *
 * 数据有两个来源, 互补使用:
 * - WebSocket 实时推送(进度、日志、结果条目), 用于即时反馈;
 * - ``GET /api/v1/scrape/status`` 轮询, 用于页面刷新后恢复统计数字.
 *
 * 之所以不完全依赖 WebSocket: 刮削任务跑在服务端后台线程, 与浏览器连接无关,
 * 用户关闭页面期间推送的消息会永久丢失, 只能靠状态查询补回来.
 */

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { getScrapeResults } from "@/client/sdk.gen";
import type { ScrapeStatus } from "@/client/types.gen";
import type { LogEntry, WebSocketMessage } from "@/hooks/useWebSocket";

export interface ScrapeResultDetail {
  title?: string;
  actors?: string;
  release?: string;
  year?: string;
  number?: string;
  mosaic?: string;
  poster_path?: string;
  fanart_path?: string;
  file_path?: string;
  folder_path?: string;
  nfo_path?: string;
}

export interface FailedDetail {
  id: string;
  text: string;
}

export interface ScrapeListItem {
  /** 唯一键, 用于列表渲染 */
  id: string;
  /** 显示名称 */
  name: string;
  status: "succ" | "fail";
  /** 识别出的番号 */
  realNumber: string;
  /** 记录时间戳 (秒); 历史导入的条目为 NFO 修改时间 */
  ts?: number;
  /** 预览元数据, 点击列表项时展示 */
  detail?: ScrapeResultDetail;
}

interface ScrapeState {
  running: boolean;
  progress: number;
  total: number;
  started: number;
  success: number;
  failed: number;
  elapsed: number;
  timedEnabled: boolean;
  timedNextRun: number;

  /** 当前正在处理的文件路径 */
  currentFile: string;
  /** 顶部状态文本, 例如 "🎉 恭喜！全部刮削完成！" */
  statusText: string;
  /** 统计文本, 例如 "刮削中：3 成功：2 失败：1" */
  countText: string;

  results: ScrapeListItem[];
  failedDetails: FailedDetail[];

  applyStatus: (status: ScrapeStatus) => void;
  setProgress: (progress: number) => void;
  setRunning: (running: boolean) => void;
  handleQtSignal: (msg: WebSocketMessage<LogEntry>) => void;
  /** 页面加载时拉取服务端留存的结果明细, 补回浏览器关闭期间错过的推送 */
  loadHistory: () => Promise<void>;
  clearResults: () => void;
}

/** 最多保留的结果条目数, 防止长时间刮削撑爆内存 */
const MAX_RESULTS = 2000;
const MAX_FAILED_DETAILS = 2000;

let seq = 0;
const nextId = () => {
  seq += 1;
  return `r${seq}`;
};

/** 从 WebSocket 推送的 show_data (后端 asdict 结果) 里挑出预览需要的字段 */
function detailFromShowData(sd: unknown): ScrapeResultDetail | undefined {
  if (!sd || typeof sd !== "object") return undefined;
  const d = sd as Record<string, Record<string, unknown> | undefined>;
  const data = d.data ?? {};
  const info = d.file_info ?? {};
  const other = d.other ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const filePath = str(info.file_show_path) ?? str(info.file_path);
  const actors = Array.isArray(data.actors) ? data.actors.filter(Boolean).join(",") : undefined;
  const detail: ScrapeResultDetail = {
    title: str(data.title),
    actors,
    release: str(data.release),
    year: str(data.year),
    number: str(data.number) ?? str(info.number),
    mosaic: str(data.mosaic),
    poster_path: str(other.poster_path),
    fanart_path: str(other.fanart_path),
    file_path: filePath,
    folder_path: str(info.folder_path),
  };
  // 全空就不占用条目空间
  return Object.values(detail).some(Boolean) ? detail : undefined;
}

export const useScrapeStore = create<ScrapeState>()(
  subscribeWithSelector((set, get) => ({
    running: false,
    progress: 0,
    total: 0,
    started: 0,
    success: 0,
    failed: 0,
    elapsed: 0,
    timedEnabled: false,
    timedNextRun: 0,
    currentFile: "",
    statusText: "等待开始 ...",
    countText: "",
    results: [],
    failedDetails: [],

    applyStatus: (status) => {
      // 轮询间隔很短, 而空闲时各项数值几乎不变. 这里先做比较, 无变化就不触发更新,
      // 否则整个刮削页每 2 秒重渲染一次, 既浪费也会干扰用户操作
      const s = get();
      if (
        s.running === status.running &&
        s.timedEnabled === (status.timed_enabled ?? false) &&
        s.timedNextRun === (status.timed_next_run ?? 0) &&
        s.progress === status.progress &&
        s.total === status.total &&
        s.started === status.started &&
        s.success === status.success &&
        s.failed === status.failed &&
        s.elapsed === status.elapsed
      ) {
        return;
      }
      set({
        running: status.running,
        progress: status.progress,
        total: status.total,
        started: status.started,
        success: status.success,
        failed: status.failed,
        elapsed: status.elapsed,
        timedEnabled: status.timed_enabled ?? false,
        timedNextRun: status.timed_next_run ?? 0,
      });
    },

    setProgress: (progress) => set({ progress }),
    setRunning: (running) => set({ running }),

    handleQtSignal: (msg) => {
      const entry = msg.data;
      if (!entry || typeof entry !== "object") return;
      const { name, data } = entry;

      switch (name) {
        case "scrape_info":
          if (typeof data === "string") set({ statusText: data });
          break;

        case "set_label_file_path":
          if (typeof data === "string") set({ currentFile: data });
          break;

        case "label_result":
          if (typeof data === "string") set({ countText: data.trim() });
          break;

        case "show_list_name": {
          // 结构: { status: "succ" | "fail", show_data: {...}, real_number: string }
          if (!data || typeof data !== "object") break;
          const payload = data as { status?: string; show_data?: unknown; real_number?: string };
          const showData = payload.show_data as { show_name?: string } | null;
          const item: ScrapeListItem = {
            id: nextId(),
            name: showData?.show_name ?? payload.real_number ?? "(未知)",
            status: payload.status === "succ" ? "succ" : "fail",
            realNumber: payload.real_number ?? "",
            ts: Date.now() / 1000,
            detail: detailFromShowData(showData),
          };
          set((state) => {
            const results = [...state.results, item];
            return { results: results.length > MAX_RESULTS ? results.slice(-MAX_RESULTS) : results };
          });
          break;
        }

        case "logs_failed_show":
          if (typeof data === "string") {
            set((state) => {
              const details = [...state.failedDetails, { id: nextId(), text: data }];
              return {
                failedDetails: details.length > MAX_FAILED_DETAILS ? details.slice(-MAX_FAILED_DETAILS) : details,
              };
            });
          }
          break;

        default:
          break;
      }
    },

    loadHistory: async () => {
      try {
        const res = await getScrapeResults();
        const data = res.data;
        if (!data) return;
        set((state) => {
          // 历史条目在前, 拉取期间可能已有少量实时条目进来, 保持在后面
          const history = data.results.map((r) => ({
            id: nextId(),
            name: r.name,
            status: r.status === "succ" ? ("succ" as const) : ("fail" as const),
            realNumber: r.real_number,
            ts: r.ts || undefined,
            detail: (r.detail ?? undefined) as ScrapeResultDetail | undefined,
          }));
          return {
            results: [...history, ...state.results].slice(-MAX_RESULTS),
            failedDetails: [
              ...data.failed_details.map((t) => ({ id: nextId(), text: t })),
              ...state.failedDetails,
            ].slice(-MAX_FAILED_DETAILS),
          };
        });
      } catch (err) {
        console.error("加载历史结果失败:", err);
      }
    },

    clearResults: () => set({ results: [], failedDetails: [] }),
  })),
);
