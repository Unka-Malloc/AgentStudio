# PaddleOCR Sidecar

当前 OCR 通过 `server/platform/modules/knowledge/file-processor/FileNormalizer/OCR/paddle-ocr.mjs` 调用这个目录下的 `paddle_ocr_extract.py`。

它不会被打进 Flutter 客户端；应该部署在服务端所在机器。
在当前方案里，它属于**可选补充能力**，不是主 OCR 方案。云端或外部视觉解析能力应通过 `docs/functionality/KNOWLEDGE.md` 中的 parser / evidence 边界接入，而不是让 OCR sidecar 成为公共知识事实源。

如果要做带 OCR sidecar 的本地服务部署，本地 Python 运行时需要按 `server/platform/modules/knowledge/ocr/runtime/README.md` 的目录约定预先放好。
这些运行时二进制默认不进入 GitHub 源码仓。

## 配置项

- `ocrEnabled`
  默认 `true`
- `ocrPythonPath`
  指向安装了 `paddleocr` 与 `paddlepaddle` 的 Python 可执行文件
- `ocrLanguage`
  默认 `ch`

也可以通过环境变量设置：

- `PACT_OCR_ENABLED`
- `PACT_OCR_PYTHON_PATH`
- `PACT_PADDLEOCR_LANG`

如果没有手工填写 `ocrPythonPath`，程序会按下面顺序找：

1. `server/platform/modules/knowledge/ocr/runtime/<platform-arch>/...`
2. 项目目录下的 `.venv-paddleocr` / `.venv`
3. 系统 `python` / `python3`

## 当前覆盖

- 图片：直接 OCR，并保留原图给视觉模型
- PDF：常规文本提取为空时，回退 PaddleOCR

## 当前边界

- `docx/ppt/xls` 这类内嵌图片文档，暂时不做图片层 OCR
- 首次运行 PaddleOCR 可能下载模型，因此部署环境需要预装好依赖或提前准备缓存
