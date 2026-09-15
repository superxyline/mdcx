"""交互式提问的应答接口.

配合 :mod:`mdcx.server.ask`: 后台刮削线程遇到需要用户决策的分支时(例如
"上次刮削未完成, 是否继续"), 会把问题通过 WebSocket 推给浏览器并阻塞等待,
前端弹出对话框, 用户选择后调用 ``POST /ask/{question_id}`` 回填答案.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...ask import ask_manager

router = APIRouter(prefix="/ask", tags=["交互提问"])


class AskAnswer(BaseModel):
    value: str = Field(description="用户所选选项的 value")


@router.get("/pending", operation_id="getPendingAsks", summary="获取待回答的问题")
async def get_pending_asks() -> list[dict]:
    """列出所有等待回答的问题.

    页面刷新或重连后调用此接口, 可以恢复错过的提问对话框.
    """
    return ask_manager.list_pending()


@router.post("/{question_id}", operation_id="answerAsk", summary="回答问题")
async def answer_ask(question_id: str, body: AskAnswer) -> dict[str, str]:
    """提交某个问题的答案, 唤醒等待中的后台任务."""
    if not ask_manager.answer(question_id, body.value):
        raise HTTPException(status_code=404, detail="问题不存在, 已回答或选项无效.")
    return {"message": "已提交"}
