export type SegmentedControlItem = {
  value: string;
  label: string;
  // 允许直接传 SVG 字符串，便于在模板层复用现有 icon 资源。
  // 如果不传，仍可只显示文字。
  iconSvg?: string;
  textColor?: string;
  hoverBg?: string;
  activeBg?: string;
  activeTextColor?: string;
  disabled?: boolean;
  title?: string;
};

export type SegmentedControlOptions = {
  items: SegmentedControlItem[];
  value?: string;
  ariaLabel?: string;
  disabled?: boolean;
  equalWidth?: boolean;
  onChange?: (value: string, item: SegmentedControlItem) => void;
};

export type SegmentedControlApi = {
  el: HTMLDivElement;
  getValue: () => string;
  setValue: (value: string, emitChange?: boolean) => void;
  setDisabled: (disabled: boolean) => void;
  setItemDisabled: (value: string, disabled: boolean) => void;
  setItemLabel: (value: string, label: string) => void;
  refreshLayout: () => void;
  dispose: () => void;
};

// 组件化分段模式条。
// 语义上使用 tablist/tab，便于屏幕阅读器和键盘导航：
// - 左右方向键切换
// - Home/End 跳到首尾
// - Enter/Space 激活当前项
export function createSegmentedControl(opts: SegmentedControlOptions): SegmentedControlApi {
  if (!opts.items.length) {
    throw new Error("Segmented control requires at least one item.");
  }

  const root = document.createElement("div");
  root.className = "segmented-control";
  root.setAttribute("role", "tablist");
  if (opts.ariaLabel) {
    root.setAttribute("aria-label", opts.ariaLabel);
  }

  const itemsByValue = new Map<string, SegmentedControlItem>();
  const buttonsByValue = new Map<string, HTMLButtonElement>();
  const labelsByValue = new Map<string, HTMLSpanElement>();
  let disabled = !!opts.disabled;
  let currentValue = "";
  const equalWidth = opts.equalWidth ?? true;
  let widthSyncRaf = 0;
  const resizeObserver =
    equalWidth && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (widthSyncRaf) cancelAnimationFrame(widthSyncRaf);
          widthSyncRaf = requestAnimationFrame(() => {
            widthSyncRaf = 0;
            syncEqualWidths();
          });
        })
      : null;

  const enabledItems = () => opts.items.filter((item) => !item.disabled);

  const getFallbackValue = () => {
    const firstEnabled = enabledItems()[0];
    if (!firstEnabled) {
      throw new Error("Segmented control requires at least one enabled item.");
    }
    return firstEnabled.value;
  };

  const updateButtonState = (button: HTMLButtonElement, item: SegmentedControlItem, selected: boolean) => {
    const isDisabled = disabled || !!item.disabled;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected && !isDisabled ? 0 : -1;
    button.disabled = isDisabled;
    button.dataset.value = item.value;
  };

  const focusValue = (value: string) => {
    const button = buttonsByValue.get(value);
    if (button && !button.disabled) {
      button.focus();
    }
  };

  const syncSelectedState = () => {
    for (const item of opts.items) {
      const button = buttonsByValue.get(item.value);
      if (!button) continue;
      updateButtonState(button, item, item.value === currentValue);
    }
  };

  const syncEqualWidths = () => {
    if (!equalWidth) return;
    let maxWidth = 0;
    for (const button of buttonsByValue.values()) {
      button.style.width = "";
    }
    for (const button of buttonsByValue.values()) {
      const measuredWidth = Math.ceil(
        Math.max(button.getBoundingClientRect().width, button.scrollWidth),
      );
      maxWidth = Math.max(maxWidth, measuredWidth);
    }
    if (maxWidth <= 0) return;
    for (const button of buttonsByValue.values()) {
      button.style.width = `${maxWidth}px`;
    }
  };

  const emitChange = () => {
    const item = itemsByValue.get(currentValue);
    if (!item) return;
    opts.onChange?.(currentValue, item);
  };

  const setValue = (value: string, emit = true) => {
    const item = itemsByValue.get(value);
    if (!item || item.disabled) {
      value = getFallbackValue();
    }
    if (currentValue === value) {
      syncSelectedState();
      return;
    }
    currentValue = value;
    syncSelectedState();
    if (emit) emitChange();
  };

  for (const item of opts.items) {
    if (itemsByValue.has(item.value)) {
      throw new Error(`Duplicated segmented control value: ${item.value}`);
    }
    itemsByValue.set(item.value, item);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "segmented-control__item";
    button.setAttribute("role", "tab");
    if (item.title) {
      button.title = item.title;
    }
    if (item.textColor) {
      button.style.setProperty("--seg-item-text-local", item.textColor);
    }
    if (item.hoverBg) {
      button.style.setProperty("--seg-item-hover-bg", item.hoverBg);
    }
    if (item.activeBg) {
      button.style.setProperty("--seg-item-active-bg-local", item.activeBg);
    }
    if (item.activeTextColor) {
      button.style.setProperty("--seg-item-active-text-local", item.activeTextColor);
    }

    const iconWrap = document.createElement("span");
    iconWrap.className = "segmented-control__icon";
    if (item.iconSvg) {
      // 该组件设计用于消费受控的内部 SVG 资源。
      // 若后续需要接收不可信输入，应改为显式创建 SVG 节点而不是 innerHTML。
      iconWrap.innerHTML = item.iconSvg;
    } else {
      iconWrap.classList.add("segmented-control__icon--empty");
    }

    const label = document.createElement("span");
    label.className = "segmented-control__label";
    label.textContent = item.label;

    button.appendChild(iconWrap);
    button.appendChild(label);

    button.addEventListener("click", () => {
      if (button.disabled) return;
      setValue(item.value);
    });

    buttonsByValue.set(item.value, button);
    labelsByValue.set(item.value, label);
    resizeObserver?.observe(button);
    root.appendChild(button);
  }

  currentValue = opts.value && itemsByValue.has(opts.value) ? opts.value : getFallbackValue();
  syncSelectedState();
  syncEqualWidths();
  resizeObserver?.observe(root);

  return {
    el: root,
    getValue: () => currentValue,
    setValue,
    setDisabled(nextDisabled: boolean) {
      disabled = nextDisabled;
      syncSelectedState();
      syncEqualWidths();
    },
    setItemDisabled(value: string, nextDisabled: boolean) {
      const item = itemsByValue.get(value);
      if (!item) return;
      item.disabled = nextDisabled;
      if (currentValue === value && nextDisabled) {
        currentValue = getFallbackValue();
      }
      syncSelectedState();
      syncEqualWidths();
    },
    setItemLabel(value: string, nextLabel: string) {
      const item = itemsByValue.get(value);
      const label = labelsByValue.get(value);
      if (!item || !label) return;
      item.label = nextLabel;
      label.textContent = nextLabel;
      syncEqualWidths();
    },
    refreshLayout() {
      syncEqualWidths();
    },
    dispose() {
      if (widthSyncRaf) cancelAnimationFrame(widthSyncRaf);
      resizeObserver?.disconnect();
      root.remove();
      buttonsByValue.clear();
      labelsByValue.clear();
      itemsByValue.clear();
    },
  };
}
