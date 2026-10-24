import { Add } from "@mui/icons-material";
import { Box, Button, Chip, Dialog, DialogContent, InputAdornment, TextField, Typography } from "@mui/material";
import type { FieldProps } from "@rjsf/utils";
import { useState } from "react";
import { FileBrowser } from "../FileBrowser";

type CustomProps = {
  multiple?: boolean;
  type?: "file" | "directory" | "mixed";
  initialPath?: string;
  refField?: string;
};

export const ServerPathField = ({
  uiSchema,
  schema,
  onChange,
  formData,
  label,
  required,
  registry,
  disabled,
  readonly,
}: FieldProps) => {
  const [open, setOpen] = useState(false);
  const { customProps } = uiSchema as { customProps: CustomProps };
  const { title, description } = schema;
  const { multiple = false, type = "mixed", initialPath: initialPathFromUi, refField } = customProps || {};

  const { formContext } = registry;
  const formState = formContext.formData || {};

  const getInitialPath = () => {
    if (refField && formState[refField]) {
      return formState[refField];
    }
    return initialPathFromUi || ".";
  };

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const currentPaths: string[] = Array.isArray(formData) ? formData : [];

  const handleSelect = (paths: string[]) => {
    if (multiple) {
      // 多目录字段: 在已有列表上追加去重, 而不是整组替换, 便于分多次逐个添加
      const merged = [...currentPaths];
      for (const p of paths) {
        if (!merged.includes(p)) merged.push(p);
      }
      onChange(merged);
    } else {
      onChange(paths[0]);
    }
    handleClose();
  };

  const removePath = (target: string) => onChange(currentPaths.filter((p) => p !== target));

  return (
    <>
      {title && (
        <Typography variant="subtitle1" component="label" sx={{ fontWeight: 500, mb: 0.5, display: "block" }}>
          {title}
          {required && <span style={{ color: "error.main" }}> *</span>}
        </Typography>
      )}
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {description}
        </Typography>
      )}
      {multiple ? (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center" }}>
          {currentPaths.map((p) => (
            <Chip
              key={p}
              label={p}
              size="small"
              variant="outlined"
              onDelete={disabled || readonly ? undefined : () => removePath(p)}
            />
          ))}
          <Button size="small" variant="outlined" startIcon={<Add />} onClick={handleOpen} disabled={disabled || readonly}>
            添加目录
          </Button>
        </Box>
      ) : (
        <TextField
          label={label}
          value={formData || ""}
          required={required}
          fullWidth
          slotProps={{
            input: {
              readOnly: true,
              endAdornment: (
                <InputAdornment position="end">
                  <Button onClick={handleOpen} disabled={disabled || readonly}>
                    选择{type === "file" ? "文件" : type === "directory" ? "目录" : "路径"}
                  </Button>
                </InputAdornment>
              ),
            },
          }}
        />
      )}
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogContent>
          <Box sx={{ pt: 1 }}>
            {/* 条件挂载: 每次打开都是干净的浏览与勾选状态, 不会残留上一次的选择 */}
            {open && (
              <FileBrowser
                initialPath={getInitialPath()}
                onSelect={handleSelect}
                allowMultiple={multiple}
                selectionType={type}
              />
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};
