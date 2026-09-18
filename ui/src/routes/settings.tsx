import { Button, FormControl, Stack, Typography } from "@mui/material";
import type { IChangeEvent } from "@rjsf/core";
import { Form } from "@rjsf/mui";
import type { RJSFSchema } from "@rjsf/utils";
import validator from "@rjsf/validator-ajv8";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  getConfigSchemaOptions,
  getConfigUiSchemaOptions,
  getCurrentConfigOptions,
  updateConfigMutation,
} from "@/client/@tanstack/react-query.gen";
import type { ConfigInput } from "@/client/types.gen";
import { fields } from "@/components/form";
import { useToast } from "@/contexts/ToastProvider";

export const Route = createFileRoute("/settings")({
  component: SettingsComponent,
});

/** 按键名排序后序列化, 避免同一份数据因字段顺序不同被判定为有改动. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function SettingsComponent() {
  const configQ = useQuery(getCurrentConfigOptions());
  const schemaQ = useQuery(getConfigSchemaOptions());
  const uiSchemaQ = useQuery(getConfigUiSchemaOptions());
  const { showSuccess, showError } = useToast();

  const saveConfig = useMutation(updateConfigMutation());

  // rjsf 是受控表单, 需要一个本地草稿; 只在首次拿到服务端配置时填充,
  // 这样后台重新拉取不会冲掉正在编辑的内容.
  const [draft, setDraft] = useState<ConfigInput | null>(null);
  // 判断"是否有改动"不能依赖 onChange 是否触发过: rjsf 初始化时会自行触发一次,
  // 所以改为把当前草稿与上一次落盘的内容做比较.
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (configQ.data && draft === null) {
      setDraft(configQ.data);
      setBaseline(stableStringify(configQ.data));
    }
  }, [configQ.data, draft]);

  const dirty = draft !== null && baseline !== null && stableStringify(draft) !== baseline;

  // 配置项多达百余条, 用户改完后可能直接刷新或关闭页面, 这里拦一下避免白改
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const handleSubmit = async ({ formData }: IChangeEvent<ConfigInput>) => {
    if (!formData) return;
    try {
      await saveConfig.mutateAsync({ body: formData });
      // 基线取刚提交的内容, 而不是服务端返回值: 表单里持有的值就是这份数据,
      // 换成返回值会让两者再次出现差异, 保存后仍显示"有未保存的修改".
      setBaseline(stableStringify(formData));
      showSuccess("配置已保存");
      void configQ.refetch(); // 不参与判定, 仅让缓存与后端保持一致
    } catch (error) {
      showError(`保存失败: ${error}`);
    }
  };

  return (
    schemaQ.isSuccess &&
    uiSchemaQ.isSuccess &&
    draft && (
      <div className="p-2">
        <Typography variant="h4" gutterBottom>
          设置
        </Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <Form
            schema={schemaQ.data as RJSFSchema}
            uiSchema={uiSchemaQ.data}
            validator={validator}
            formData={draft}
            fields={fields}
            onChange={({ formData: next }: IChangeEvent<ConfigInput>) => {
              if (next) setDraft(next);
            }}
            onSubmit={handleSubmit}
            onError={() => showError("表单校验未通过, 请检查标红的字段")}
          >
            {/* 表单有上百个字段, 默认的提交按钮被顶到最底部, 用户改完根本找不到;
                这里换成固定在右下角的悬浮栏, 让保存随时可点 */}
            <Stack
              direction="row"
              spacing={2}
              sx={{
                position: "fixed",
                right: 24,
                bottom: 24,
                zIndex: (theme) => theme.zIndex.snackbar,
                alignItems: "center",
                bgcolor: "background.paper",
                border: 1,
                borderColor: "divider",
                borderRadius: 2,
                boxShadow: 4,
                px: 2,
                py: 1,
              }}
            >
              {dirty && (
                <Typography variant="body2" color="warning.main">
                  有未保存的修改
                </Typography>
              )}
              <Button type="submit" variant="contained" disabled={saveConfig.isPending || !dirty}>
                {saveConfig.isPending ? "保存中..." : "保存"}
              </Button>
            </Stack>
          </Form>
        </FormControl>
      </div>
    )
  );
}
