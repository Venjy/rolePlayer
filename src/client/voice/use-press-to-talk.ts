import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type PointerEventHandler,
} from "react";
import {
  PressToTalkController,
  type PressToTalkControllerHandlers,
  type PressToTalkVisualState,
} from "./press-to-talk-controller";

export interface UsePressToTalkOptions {
  enabled: boolean;
  start: () => Promise<boolean>;
  submit: () => Promise<void>;
  cancel: () => Promise<void>;
}

export interface PressToTalkBindings {
  onPointerDown: PointerEventHandler<HTMLElement>;
  onPointerMove: PointerEventHandler<HTMLElement>;
  onPointerUp: PointerEventHandler<HTMLElement>;
  onPointerCancel: PointerEventHandler<HTMLElement>;
  onLostPointerCapture: PointerEventHandler<HTMLElement>;
  onKeyDown: KeyboardEventHandler<HTMLElement>;
  onKeyUp: KeyboardEventHandler<HTMLElement>;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}

const IDLE_VISUAL_STATE: PressToTalkVisualState = {
  pressed: false,
  cancelling: false,
};

/** Maps mouse, touch, pen and keyboard holds onto one recording lifecycle. */
export function usePressToTalk(options: UsePressToTalkOptions): {
  visualState: PressToTalkVisualState;
  bindings: PressToTalkBindings;
  cancelActiveGesture: () => Promise<void>;
} {
  const [visualState, setVisualState] =
    useState<PressToTalkVisualState>(IDLE_VISUAL_STATE);
  const activePointerIdRef = useRef<number | undefined>(undefined);
  const keyboardActiveRef = useRef(false);
  const [controller] = useState(() => {
    const handlers: PressToTalkControllerHandlers = {
      start: options.start,
      submit: options.submit,
      cancel: options.cancel,
      onVisualState: setVisualState,
    };
    return new PressToTalkController(handlers);
  });

  useEffect(() => {
    controller.updateHandlers({
      start: options.start,
      submit: options.submit,
      cancel: options.cancel,
      onVisualState: setVisualState,
    });
  }, [controller, options.cancel, options.start, options.submit]);

  const cancelActiveGesture = useCallback(() => {
    if (!controller.isActivePress) return Promise.resolve();
    activePointerIdRef.current = undefined;
    keyboardActiveRef.current = false;
    return controller.release(true);
  }, [controller]);

  useEffect(() => {
    const handleWindowBlur = () => void cancelActiveGesture();
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") void cancelActiveGesture();
    };
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [cancelActiveGesture]);

  useEffect(() => {
    if (!options.enabled) void cancelActiveGesture();
  }, [cancelActiveGesture, options.enabled]);

  useEffect(
    () => () => {
      void cancelActiveGesture();
    },
    [cancelActiveGesture],
  );

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (!options.enabled || event.button !== 0) return;
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    void controller.press(event.clientY);
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    controller.move(event.clientY);
  };

  const releasePointer = (event: React.PointerEvent<HTMLElement>, cancel: boolean) => {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = undefined;
    void controller.release(cancel);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    if (
      !options.enabled ||
      keyboardActiveRef.current ||
      (event.key !== " " && event.key !== "Enter")
    ) {
      return;
    }
    event.preventDefault();
    keyboardActiveRef.current = true;
    void controller.press(0);
  };

  const onKeyUp: KeyboardEventHandler<HTMLElement> = (event) => {
    if (
      !keyboardActiveRef.current ||
      (event.key !== " " && event.key !== "Enter")
    ) {
      return;
    }
    event.preventDefault();
    keyboardActiveRef.current = false;
    void controller.release(false);
  };

  return {
    visualState,
    cancelActiveGesture,
    bindings: {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => releasePointer(event, false),
      onPointerCancel: (event) => releasePointer(event, true),
      onLostPointerCapture: (event) => {
        if (
          activePointerIdRef.current === event.pointerId &&
          controller.isActivePress
        ) {
          releasePointer(event, true);
        }
      },
      onKeyDown,
      onKeyUp,
      onContextMenu: (event) => event.preventDefault(),
    },
  };
}
