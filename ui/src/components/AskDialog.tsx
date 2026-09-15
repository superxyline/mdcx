/**
 * 服务端提问对话框.
 *
 * 后台刮削线程遇到需要用户决策的分支时(例如"上次刮削未完成, 是否继续"),
 * 会阻塞等待回答. 服务端没有 QMessageBox 这类同步 UI, 因此把问题推给浏览器,
 * 用户在这里选择后回填答案, 后台线程继续.
 *
 * 对话框不可随意关闭: 后台线程正在等待, 关闭而不作答会让它一直等到超时.
 * 所有问题都应包含一个"取消"语义的选项, 由服务端在构造问题时提供.
 *
 * ``server`` 字段同时提供两种到达方式: WebSocket 实时推送, 以及页面刷新后的
 * ``GET /ask/pending`` 补拉, 二者按 question_id 去重.
 */

import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { useEffect, useState } from "react";
import { answerAsk, getPendingAsks } from "@/client/sdk.gen";
import { webSocketManager } from "@/hooks/useWebSocket";

interface AskOption {
  value: string;
  label: string;
  style: "primary" | "default" | "danger";
}

export interface AskRequest {
  question_id: string;
  question: string;
  detail: string;
  options: AskOption[];
}

const dedupe = (prev: AskRequest[], incoming: AskRequest[]) => [
  ...prev,
  ...incoming.filter((i) => !prev.some((q) => q.question_id === i.question_id)),
];

export function AskDialog() {
  const [queue, setQueue] = useState<AskRequest[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 实时接收服务端提问
  useEffect(() => {
    return webSocketManager.addHandler<AskRequest>("ask", (data) => {
      if (!data?.question_id) return;
      setQueue((prev) => dedupe(prev, [data]));
    });
  }, []);

  // 页面刷新或重连后, 补拉仍在等待回答的问题
  useEffect(() => {
    let cancelled = false;
    getPendingAsks()
      .then((res) => {
        if (cancelled) return;
        const items = (res.data ?? []) as unknown as AskRequest[];
        if (items.length) setQueue((prev) => dedupe(prev, items));
      })
      .catch((err) => console.error("获取待答问题失败:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const current = queue[0];
  if (!current) return null;

  const handleAnswer = async (value: string) => {
    setSubmitting(true);
    try {
      await answerAsk({ path: { question_id: current.question_id }, body: { value } });
    } catch (err) {
      console.error("提交答案失败:", err);
    } finally {
      setSubmitting(false);
      setQueue((prev) => prev.filter((q) => q.question_id !== current.question_id));
    }
  };

  return (
    <Dialog open maxWidth="sm" fullWidth disableEscapeKeyDown>
      <DialogTitle>{current.question}</DialogTitle>
      {current.detail ? (
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: "pre-wrap" }}>{current.detail}</DialogContentText>
        </DialogContent>
      ) : null}
      <DialogActions sx={{ px: 3, pb: 2, gap: 8 }}>
        {current.options.map((opt) => (
          <Button
            key={opt.value}
            variant={opt.style === "primary" ? "contained" : "text"}
            color={opt.style === "danger" ? "error" : "primary"}
            disabled={submitting}
            onClick={() => handleAnswer(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </DialogActions>
    </Dialog>
  );
}
