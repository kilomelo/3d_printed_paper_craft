import GIF from "gif.js";
import gifWorkerScriptUrl from "gif.js/dist/gif.worker.js?url";

type Renderer3DForGifCapture = {
  hasActiveDisplayModel: () => boolean;
  getRendererCanvas: () => HTMLCanvasElement;
  rotateViewHorizontally: (deltaRadians: number) => void;
  renderNow: () => void;
  isAxesInsetVisible: () => boolean;
  setAxesInsetVisible: (visible: boolean) => void;
  setCaptureBackgroundTransparent: (enabled: boolean) => void;
};

type CreateGifCaptureControllerArgs = {
  renderer3d: Renderer3DForGifCapture;
  getTargetHeight: () => number;
  downloadBlob: (blob: Blob, filename: string) => void;
  log: (msg: string, tone?: "info" | "error" | "success") => void;
  showLoadingOverlay: () => void;
  hideLoadingOverlay: () => void;
  gifRecordBtn?: HTMLButtonElement | null;
  gifFps?: number;
  frameCount?: number;
  turns?: number;
};

const GIF_CHROMA_KEY_RGB = { r: 0, g: 255, b: 0 } as const;
const GIF_ALPHA_CUTOFF = 64;

const captureCanvasBlob = async (canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> => {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("canvas.toBlob returned null"));
        return;
      }
      resolve(blob);
    }, type);
  });
};

const renderGifBlob = async (gif: GIF): Promise<Blob> => {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    gif.once("finished", (blob) => {
      if (settled) return;
      settled = true;
      resolve(blob);
    });
    gif.once("abort", () => {
      if (settled) return;
      settled = true;
      reject(new Error("gif render aborted"));
    });
    try {
      gif.render();
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(error);
    }
  });
};

export const createGifCaptureController = ({
  renderer3d,
  getTargetHeight,
  downloadBlob,
  log,
  showLoadingOverlay,
  hideLoadingOverlay,
  gifRecordBtn,
  gifFps = 30,
  frameCount = 100,
  turns = 1,
}: CreateGifCaptureControllerArgs) => {
  let gifRecordingBusy = false;

  const captureGifFromViewer = async () => {
    if (gifRecordingBusy) return;
    if (!renderer3d.hasActiveDisplayModel()) {
      log("当前没有可录制的模型", "error");
      return;
    }
    gifRecordingBusy = true;
    if (gifRecordBtn) gifRecordBtn.disabled = true;
    showLoadingOverlay();
    let prevAxesInsetVisible: boolean | null = null;
    try {
      const frameDelayMs = Math.max(1, Math.round(1000 / gifFps));
      const canvas = renderer3d.getRendererCanvas();
      const sourceWidth = canvas.width;
      const sourceHeight = canvas.height;
      const targetHeight = getTargetHeight();
      const targetWidth = Math.max(1, Math.round((sourceWidth / sourceHeight) * targetHeight));
      const width = targetWidth;
      const height = targetHeight;
      if (width <= 0 || height <= 0) {
        throw new Error("invalid canvas size");
      }
      const readCanvas = document.createElement("canvas");
      readCanvas.width = width;
      readCanvas.height = height;
      const readCtx = readCanvas.getContext("2d", { willReadFrequently: true });
      if (!readCtx) throw new Error("cannot init 2D context for gif capture");
      const stillCanvas = document.createElement("canvas");
      stillCanvas.width = width;
      stillCanvas.height = height;
      const stillCtx = stillCanvas.getContext("2d", { willReadFrequently: true });
      if (!stillCtx) throw new Error("cannot init 2D context for still capture");

      const gif = new GIF({
        workers: Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2)),
        quality: 1,
        repeat: 0,
        workerScript: gifWorkerScriptUrl,
        background: "#00ff00",
        width,
        height,
        dither: false,
        debug: false,
      });
      (gif as unknown as { setOption: (key: string, value: unknown) => void }).setOption("transparent", 0x00ff00);
      (gif as unknown as { setOption: (key: string, value: unknown) => void }).setOption("globalPalette", true);
      const angleStep = ((Math.PI * 2) * turns) / Math.max(1, frameCount);
      let firstFramePngBlob: Blob | null = null;
      prevAxesInsetVisible = renderer3d.isAxesInsetVisible();
      renderer3d.setAxesInsetVisible(false);
      renderer3d.setCaptureBackgroundTransparent(true);

      for (let i = 0; i < frameCount; i += 1) {
        if (i > 0) renderer3d.rotateViewHorizontally(angleStep);
        renderer3d.renderNow();
        stillCtx.clearRect(0, 0, width, height);
        stillCtx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
        const imageData = stillCtx.getImageData(0, 0, width, height);
        const data = imageData.data;
        for (let p = 0; p < data.length; p += 4) {
          const alpha = data[p + 3];
          if (alpha < GIF_ALPHA_CUTOFF) {
            data[p] = GIF_CHROMA_KEY_RGB.r;
            data[p + 1] = GIF_CHROMA_KEY_RGB.g;
            data[p + 2] = GIF_CHROMA_KEY_RGB.b;
            data[p + 3] = 255;
            continue;
          }
          data[p + 3] = 255;
        }
        readCtx.putImageData(imageData, 0, 0);
        gif.addFrame(readCtx, { copy: true, delay: frameDelayMs, dispose: 2 });
        if (i === 0) {
          firstFramePngBlob = await captureCanvasBlob(stillCanvas, "image/png");
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      renderer3d.rotateViewHorizontally(-angleStep * (frameCount - 1));
      renderer3d.setCaptureBackgroundTransparent(false);
      renderer3d.setAxesInsetVisible(prevAxesInsetVisible);
      renderer3d.renderNow();

      const gifBlob = await renderGifBlob(gif);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      downloadBlob(gifBlob, `demo_${stamp}.gif`);
      if (firstFramePngBlob) {
        downloadBlob(firstFramePngBlob, `demo_${stamp}_still.png`);
      }
      log("GIF 录制完成（已导出 GIF + 第一帧 PNG）", "success");
    } catch (error) {
      console.error("[gif recorder] failed", error);
      log("GIF 录制失败", "error");
    } finally {
      renderer3d.setCaptureBackgroundTransparent(false);
      if (prevAxesInsetVisible !== null) {
        renderer3d.setAxesInsetVisible(prevAxesInsetVisible);
      }
      hideLoadingOverlay();
      if (gifRecordBtn) gifRecordBtn.disabled = false;
      gifRecordingBusy = false;
    }
  };

  return {
    captureGifFromViewer,
  };
};
