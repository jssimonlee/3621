(() => {
  "use strict";

  const STORAGE_KEY = "formtec3621-state-v1";
  const DEFAULTS = {
    text: "",
    startPosition: 1,
    duplicateEach: false,
    settings: {
      fontChoice: "auto",
      baseFontSize: 22,
      fontSizeCustomized: false,
      persistText: true,
      numberingOrder: "row",
      leftPadding: 3,
      offsetX: 0,
      offsetY: 0,
    },
    sizeAdjustments: {},
  };

  const el = {
    labelInput: document.querySelector("#labelInput"),
    itemCount: document.querySelector("#itemCount"),
    savedState: document.querySelector("#savedState"),
    appendSuffixButton: document.querySelector("#appendSuffixButton"),
    clearButton: document.querySelector("#clearButton"),
    startPosition: document.querySelector("#startPosition"),
    previewStage: document.querySelector("#previewStage"),
    previewSheetWrap: document.querySelector("#previewSheetWrap"),
    overflowGuide: document.querySelector("#overflowGuide"),
    multiSelectionHint: document.querySelector("#multiSelectionHint"),
    selectOverflowButton: document.querySelector("#selectOverflowButton"),
    duplicateToggle: document.querySelector("#duplicateToggle"),
    currentPage: document.querySelector("#currentPage"),
    totalPages: document.querySelector("#totalPages"),
    prevPage: document.querySelector("#prevPage"),
    nextPage: document.querySelector("#nextPage"),
    settingsButton: document.querySelector("#settingsButton"),
    settingsDialog: document.querySelector("#settingsDialog"),
    printGuideDialog: document.querySelector("#printGuideDialog"),
    cancelPrintGuide: document.querySelector("#cancelPrintGuide"),
    openPrintDialog: document.querySelector("#openPrintDialog"),
    fontChoice: document.querySelector("#fontChoice"),
    localFontOptions: document.querySelector("#localFontOptions"),
    numberingOrderInputs: [...document.querySelectorAll('input[name="numberingOrder"]')],
    baseFontSize: document.querySelector("#baseFontSize"),
    persistText: document.querySelector("#persistText"),
    leftPadding: document.querySelector("#leftPadding"),
    offsetX: document.querySelector("#offsetX"),
    offsetY: document.querySelector("#offsetY"),
    resetSettings: document.querySelector("#resetSettings"),
    printButton: document.querySelector("#printButton"),
    printPages: document.querySelector("#printPages"),
    toast: document.querySelector("#toast"),
  };

  let state = loadState();
  let sourceItems = [];
  let items = [];
  let currentPage = 0;
  let selectedItemIndices = new Set();
  let selectionAnchorIndex = null;
  let activeItemIndex = null;
  let overflowingItemIndices = new Set();
  let hyFontAvailable = false;
  let saveTimer;
  let toastTimer;

  function clearSelection() {
    selectedItemIndices.clear();
    selectionAnchorIndex = null;
    activeItemIndex = null;
  }

  function selectedNumberingOrder() {
    return el.numberingOrderInputs.find((input) => input.checked)?.value || "row";
  }

  function setNumberingOrderControl(value) {
    el.numberingOrderInputs.forEach((input) => { input.checked = input.value === value; });
  }

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!stored) return structuredClone(DEFAULTS);
      return {
        ...structuredClone(DEFAULTS),
        ...stored,
        settings: { ...DEFAULTS.settings, ...(stored.settings || {}) },
        sizeAdjustments: stored.sizeAdjustments || {},
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  function saveState(showIndicator = true) {
    const savedState = structuredClone(state);
    if (!savedState.settings.persistText) savedState.text = "";
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
    } catch {
      showToast("브라우저 저장 공간을 사용할 수 없어 자동 저장하지 못했습니다.");
      return;
    }
    if (!state.settings.persistText) {
      el.savedState.classList.remove("visible");
      return;
    }
    if (!showIndicator) return;
    clearTimeout(saveTimer);
    el.savedState.classList.add("visible");
    saveTimer = setTimeout(() => el.savedState.classList.remove("visible"), 1400);
  }

  function getItems(text) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function rebuildItems() {
    sourceItems = getItems(state.text);
    if (state.duplicateEach) migrateLegacyDuplicateAdjustments();
    items = state.duplicateEach
      ? sourceItems.flatMap((item) => [item, item])
      : [...sourceItems];
  }

  function migrateLegacyDuplicateAdjustments() {
    sourceItems.forEach((_, sourceIndex) => {
      const sharedKey = String(sourceIndex);
      if (state.sizeAdjustments[sharedKey] !== undefined) return;
      const oldFirstCopy = state.sizeAdjustments[`double:${sourceIndex * 2}`];
      const oldSecondCopy = state.sizeAdjustments[`double:${sourceIndex * 2 + 1}`];
      const previousAdjustment = oldFirstCopy ?? oldSecondCopy;
      if (previousAdjustment !== undefined) state.sizeAdjustments[sharedKey] = previousAdjustment;
    });
  }

  function adjustmentKey(itemIndex) {
    return String(state.duplicateEach ? Math.floor(itemIndex / 2) : itemIndex);
  }

  function itemAdjustment(itemIndex) {
    return Number(state.sizeAdjustments[adjustmentKey(itemIndex)] || 0);
  }

  function updateDuplicateToggle() {
    el.duplicateToggle.setAttribute("aria-pressed", String(state.duplicateEach));
    el.duplicateToggle.title = state.duplicateEach
      ? "각 라벨을 1개씩 인쇄하도록 변경"
      : "각 라벨을 순서대로 2개씩 인쇄";
  }

  function getPageCount() {
    if (items.length === 0) return 1;
    const firstCapacity = 37 - state.startPosition;
    return items.length <= firstCapacity ? 1 : 1 + Math.ceil((items.length - firstCapacity) / 36);
  }

  function sequenceIndexForSlot(slotIndex) {
    if (state.settings.numberingOrder === "row") return slotIndex;
    const rowIndex = Math.floor(slotIndex / 2);
    return slotIndex % 2 === 0 ? rowIndex : 18 + rowIndex;
  }

  function positionForNumber(number) {
    if (state.settings.numberingOrder === "row") {
      return { row: Math.ceil(number / 2), side: number % 2 ? "왼쪽" : "오른쪽" };
    }
    return number <= 18
      ? { row: number, side: "왼쪽" }
      : { row: number - 18, side: "오른쪽" };
  }

  function itemIndexForSlot(pageIndex, slotIndex) {
    const firstCapacity = 37 - state.startPosition;
    const sequenceIndex = sequenceIndexForSlot(slotIndex);
    if (pageIndex === 0) {
      if (sequenceIndex < state.startPosition - 1) return null;
      const index = sequenceIndex - (state.startPosition - 1);
      return index < items.length ? index : null;
    }
    const index = firstCapacity + (pageIndex - 1) * 36 + sequenceIndex;
    return index < items.length ? index : null;
  }

  function selectedFontFamily() {
    if (state.settings.fontChoice.startsWith("local:")) {
      const family = state.settings.fontChoice.slice(6).replace(/["\\]/g, "");
      return `"${family}", "Noto Sans KR", "Malgun Gothic", sans-serif`;
    }
    switch (state.settings.fontChoice) {
      case "hy": return '"LocalHYGothic", "Noto Sans KR", "Malgun Gothic", sans-serif';
      case "malgun": return '"Malgun Gothic", "맑은 고딕", "Noto Sans KR", sans-serif';
      case "noto": return '"Noto Sans KR", "Malgun Gothic", sans-serif';
      default: return hyFontAvailable
        ? '"LocalHYGothic", "Noto Sans KR", "Malgun Gothic", sans-serif'
        : '"Malgun Gothic", "맑은 고딕", sans-serif';
    }
  }

  function recommendedFontSize() {
    return 22;
  }

  function createSheet(pageIndex, interactive = false) {
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.style.setProperty("--offset-x", `${state.settings.offsetX}mm`);
    sheet.style.setProperty("--offset-y", `${state.settings.offsetY}mm`);

    const grid = document.createElement("div");
    grid.className = "label-grid";
    const fragment = document.createDocumentFragment();

    for (let slot = 0; slot < 36; slot += 1) {
      const itemIndex = itemIndexForSlot(pageIndex, slot);
      const sequenceIndex = sequenceIndexForSlot(slot);
      const cell = document.createElement("div");
      cell.className = "label-cell";

      if (interactive) {
        const number = document.createElement("span");
        number.className = "slot-number";
        number.textContent = String(sequenceIndex + 1);
        cell.appendChild(number);
      }

      if (pageIndex === 0 && sequenceIndex < state.startPosition - 1) {
        cell.classList.add("skipped");
        if (interactive) {
          const skipped = document.createElement("span");
          skipped.className = "skipped-note";
          skipped.textContent = "사용한 칸";
          cell.appendChild(skipped);
        }
      }

      if (itemIndex !== null) {
        cell.classList.add("has-content");
        cell.dataset.itemIndex = itemIndex;
        const size = Number(state.settings.baseFontSize) + itemAdjustment(itemIndex);
        const text = document.createElement("span");
        text.className = "label-text";
        text.textContent = items[itemIndex];
        text.style.fontFamily = selectedFontFamily();
        text.style.fontSize = `${size}pt`;
        text.style.paddingLeft = `${state.settings.leftPadding}mm`;
        text.style.paddingRight = "1.5mm";
        cell.appendChild(text);

        if (interactive && selectedItemIndices.has(itemIndex)) cell.classList.add("selected");
        if (interactive && activeItemIndex === itemIndex) {
          cell.appendChild(createCellControls(itemIndex, size));
        }

        if (interactive) {
          cell.addEventListener("click", (event) => handleCellSelection(event, itemIndex));
        }
      }
      fragment.appendChild(cell);
    }

    grid.appendChild(fragment);
    sheet.appendChild(grid);
    return sheet;
  }

  function handleCellSelection(event, itemIndex) {
    el.previewStage.focus({ preventScroll: true });
    const additive = event.ctrlKey || event.metaKey;

    if (event.shiftKey && selectionAnchorIndex !== null) {
      if (!additive) selectedItemIndices.clear();
      const first = Math.min(selectionAnchorIndex, itemIndex);
      const last = Math.max(selectionAnchorIndex, itemIndex);
      for (let index = first; index <= last; index += 1) {
        if (index < items.length) selectedItemIndices.add(index);
      }
      activeItemIndex = itemIndex;
    } else if (additive) {
      if (selectedItemIndices.has(itemIndex)) {
        selectedItemIndices.delete(itemIndex);
        if (activeItemIndex === itemIndex) {
          activeItemIndex = [...selectedItemIndices].at(-1) ?? null;
        }
      } else {
        selectedItemIndices.add(itemIndex);
        activeItemIndex = itemIndex;
      }
      selectionAnchorIndex = itemIndex;
    } else if (selectedItemIndices.size === 1 && selectedItemIndices.has(itemIndex)) {
      clearSelection();
    } else {
      selectedItemIndices = new Set([itemIndex]);
      selectionAnchorIndex = itemIndex;
      activeItemIndex = itemIndex;
    }

    renderPreview();
  }

  function createCellControls(itemIndex, size) {
    const targetIndices = selectedItemIndices.size > 0
      ? [...selectedItemIndices]
      : [itemIndex];
    const controls = document.createElement("div");
    controls.className = "cell-controls";
    controls.setAttribute("aria-label", targetIndices.length > 1
      ? `선택한 라벨 ${targetIndices.length}개의 글자 크기 조절`
      : "이 라벨의 글자 크기 조절");

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.title = "1pt 줄이기";

    const label = document.createElement("span");
    label.className = "cell-size";
    label.textContent = targetIndices.length > 1 ? `${targetIndices.length}개 선택` : `${size}pt`;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.title = "1pt 늘리기";

    const adjust = (amount) => {
      const changes = targetIndices.map((targetIndex) => {
        const key = adjustmentKey(targetIndex);
        const current = Number(state.sizeAdjustments[key] || 0);
        return { key, nextAdjustment: current + amount };
      });
      if (changes.some(({ nextAdjustment }) => {
        const nextSize = Number(state.settings.baseFontSize) + nextAdjustment;
        return nextSize < 8 || nextSize > 40;
      })) return;
      changes.forEach(({ key, nextAdjustment }) => {
        if (nextAdjustment === 0) delete state.sizeAdjustments[key];
        else state.sizeAdjustments[key] = nextAdjustment;
      });
      saveState(false);
      renderPreview();
    };

    minus.addEventListener("click", (event) => { event.stopPropagation(); adjust(-1); });
    plus.addEventListener("click", (event) => { event.stopPropagation(); adjust(1); });
    controls.addEventListener("click", (event) => event.stopPropagation());
    controls.append(minus, label, plus);
    return controls;
  }

  function renderPreview() {
    const pages = getPageCount();
    currentPage = Math.max(0, Math.min(currentPage, pages - 1));
    el.previewSheetWrap.replaceChildren(createSheet(currentPage, true));
    el.currentPage.textContent = currentPage + 1;
    el.totalPages.textContent = pages;
    el.prevPage.disabled = currentPage === 0;
    el.nextPage.disabled = currentPage >= pages - 1;
    requestAnimationFrame(() => {
      fitPreview();
      markOverflowingLabels();
    });
  }

  function fitPreview() {
    const sheet = el.previewSheetWrap.querySelector(".sheet");
    if (!sheet) return;
    const availableWidth = Math.max(200, el.previewStage.clientWidth - 40);
    const availableHeight = Math.max(300, el.previewStage.clientHeight - 42);
    const fitScale = Math.min(availableWidth / sheet.offsetWidth, availableHeight / sheet.offsetHeight, 0.82);
    const scale = Math.max(0.52, fitScale);
    el.previewSheetWrap.style.width = `${sheet.offsetWidth * scale}px`;
    el.previewSheetWrap.style.height = `${sheet.offsetHeight * scale}px`;
    el.previewSheetWrap.style.transform = "none";
    sheet.style.transform = `scale(${scale})`;
    sheet.style.setProperty("--inverse-scale", String(1 / scale));
  }

  function markOverflowingLabels() {
    overflowingItemIndices = findOverflowingItems();
    let visibleOverflowCount = 0;
    el.previewSheetWrap.querySelectorAll(".label-cell.has-content").forEach((cell) => {
      const itemIndex = Number(cell.dataset.itemIndex);
      if (!overflowingItemIndices.has(itemIndex)) return;
      cell.classList.add("overflowing");
      visibleOverflowCount += 1;
    });
    el.overflowGuide.hidden = visibleOverflowCount === 0;
    el.multiSelectionHint.hidden = overflowingItemIndices.size < 2;
    el.selectOverflowButton.hidden = overflowingItemIndices.size < 2;
    el.selectOverflowButton.textContent = `주황색 모두 선택 (${overflowingItemIndices.size})`;
    if (visibleOverflowCount > 0) {
      el.overflowGuide.setAttribute("aria-label", `글자가 셀을 벗어나는 라벨이 전체 ${overflowingItemIndices.size}개 있습니다. 셀을 선택해서 수정하세요.`);
    }
  }

  function findOverflowingItems() {
    const overflowing = new Set();
    if (items.length === 0) return overflowing;
    const cell = document.createElement("div");
    cell.className = "label-cell overflow-measure-cell";
    const text = document.createElement("span");
    text.className = "label-text";
    text.style.fontFamily = selectedFontFamily();
    text.style.paddingLeft = `${state.settings.leftPadding}mm`;
    text.style.paddingRight = "1.5mm";
    cell.appendChild(text);
    document.body.appendChild(cell);
    items.forEach((item, itemIndex) => {
      text.textContent = item;
      text.style.fontSize = `${Number(state.settings.baseFontSize) + itemAdjustment(itemIndex)}pt`;
      if (text.scrollWidth > text.clientWidth + 1) overflowing.add(itemIndex);
    });
    cell.remove();
    return overflowing;
  }

  function renderAllPrintPages() {
    const fragment = document.createDocumentFragment();
    for (let page = 0; page < getPageCount(); page += 1) fragment.appendChild(createSheet(page, false));
    el.printPages.replaceChildren(fragment);
  }

  function syncFromText() {
    state.text = el.labelInput.value;
    rebuildItems();
    el.itemCount.textContent = sourceItems.length;
    clearSelection();
    const pages = getPageCount();
    if (currentPage >= pages) currentPage = pages - 1;
    saveState();
    renderPreview();
  }

  function syncSettings({ fontChanged = false, fontSizeChanged = false } = {}) {
    const nextFontChoice = el.fontChoice.value;
    if (fontSizeChanged) state.settings.fontSizeCustomized = true;
    if (fontChanged && !state.settings.fontSizeCustomized) {
      el.baseFontSize.value = recommendedFontSize();
    }
    state.settings.fontChoice = nextFontChoice;
    state.settings.numberingOrder = selectedNumberingOrder();
    state.settings.baseFontSize = clampNumber(el.baseFontSize.value, 8, 40, 22);
    state.settings.persistText = el.persistText.checked;
    state.settings.leftPadding = clampNumber(el.leftPadding.value, 0, 12, 3);
    state.settings.offsetX = clampNumber(el.offsetX.value, -10, 10, 0);
    state.settings.offsetY = clampNumber(el.offsetY.value, -10, 10, 0);
    saveState(false);
    renderPreview();
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function renderStartPositionOptions() {
    const options = document.createDocumentFragment();
    for (let number = 1; number <= 36; number += 1) {
      const option = document.createElement("option");
      option.value = number;
      const position = positionForNumber(number);
      option.textContent = `${number}번 · ${position.row}행 ${position.side}`;
      options.appendChild(option);
    }
    el.startPosition.replaceChildren(options);
    el.startPosition.value = state.startPosition;
  }

  function populateControls() {
    renderStartPositionOptions();
    el.labelInput.value = state.text;
    ensureStoredFontOption();
    el.fontChoice.value = state.settings.fontChoice;
    setNumberingOrderControl(state.settings.numberingOrder);
    el.baseFontSize.value = state.settings.baseFontSize;
    el.persistText.checked = state.settings.persistText;
    el.leftPadding.value = state.settings.leftPadding;
    el.offsetX.value = state.settings.offsetX;
    el.offsetY.value = state.settings.offsetY;
    rebuildItems();
    el.itemCount.textContent = sourceItems.length;
    updateDuplicateToggle();
  }

  function ensureStoredFontOption() {
    const builtInValues = {
      "Noto Sans KR": "noto",
      "맑은 고딕": "malgun",
      "Malgun Gothic": "malgun",
      "HY견고딕": "hy",
      "HYGothic-Extra": "hy",
      "HY Gothic Extra": "hy",
    };
    if (state.settings.fontChoice.startsWith("local:")) {
      const storedFamily = state.settings.fontChoice.slice(6);
      if (builtInValues[storedFamily]) state.settings.fontChoice = builtInValues[storedFamily];
    }
    if (!state.settings.fontChoice.startsWith("local:")) return;
    const family = state.settings.fontChoice.slice(6);
    const exists = [...el.localFontOptions.querySelectorAll("option")]
      .some((option) => option.value === state.settings.fontChoice);
    if (!exists) el.localFontOptions.appendChild(new Option(family, state.settings.fontChoice));
  }

  function appendFontScanOption(label = "이 컴퓨터 글꼴 불러오기…") {
    el.localFontOptions.appendChild(new Option(label, "scan-fonts"));
  }

  function koreanFontName(family) {
    const names = {
      "Malgun Gothic": "맑은 고딕",
      Batang: "바탕",
      BatangChe: "바탕체",
      Dotum: "돋움",
      DotumChe: "돋움체",
      Gulim: "굴림",
      GulimChe: "굴림체",
      Gungsuh: "궁서",
      GungsuhChe: "궁서체",
      "New Gulim": "새굴림",
      NanumGothic: "나눔고딕",
      NanumMyeongjo: "나눔명조",
      NanumBarunGothic: "나눔바른고딕",
      D2Coding: "D2 코딩",
      "Arial Unicode MS": "Arial 유니코드",
    };
    const korean = names[family];
    return korean ? `${korean} (${family})` : family;
  }

  function populateLocalFontOptions(families) {
    const currentValue = state.settings.fontChoice;
    const builtInFamilies = new Set([
      "Noto Sans KR", "맑은 고딕", "Malgun Gothic",
      "HY견고딕", "HYGothic-Extra", "HY Gothic Extra",
    ]);
    const uniqueFamilies = [...new Set(families.filter((family) => family && !builtInFamilies.has(family)))]
      .sort((a, b) => a.localeCompare(b, "ko"));
    el.localFontOptions.replaceChildren();
    appendFontScanOption("설치 글꼴 다시 불러오기…");
    uniqueFamilies.forEach((family) => {
      el.localFontOptions.appendChild(new Option(koreanFontName(family), `local:${family}`));
    });
    ensureStoredFontOption();
    el.fontChoice.value = currentValue;
  }

  async function scanLocalFonts() {
    const previousValue = state.settings.fontChoice;
    el.fontChoice.value = previousValue;
    el.fontChoice.disabled = true;
    try {
      if (typeof window.queryLocalFonts !== "function") {
        throw new Error("unsupported");
      }
      const fontData = await window.queryLocalFonts();
      const families = fontData.map((font) => font.family);
      populateLocalFontOptions(families);
      showToast(`설치된 글꼴 ${new Set(families).size}개를 불러왔습니다.`);
    } catch (error) {
      if (error?.name === "NotAllowedError") {
        showToast("설치 글꼴을 보려면 브라우저의 글꼴 접근을 허용해 주세요.");
      } else {
        const commonFonts = ["HY견고딕", "맑은 고딕", "굴림", "돋움", "바탕", "궁서", "Arial", "Arial Black", "Bahnschrift", "Segoe UI"];
        populateLocalFontOptions(commonFonts.filter((font) => document.fonts.check(`16px "${font}"`)));
        showToast("브라우저에서 확인 가능한 설치 글꼴을 불러왔습니다.");
      }
    } finally {
      el.fontChoice.value = state.settings.fontChoice;
      el.fontChoice.disabled = false;
    }
  }

  async function detectHyFont() {
    try {
      const loaded = await document.fonts.load('16px "LocalHYGothic"', "한글 ABC 123");
      hyFontAvailable = loaded.length > 0;
    } catch {
      hyFontAvailable = false;
    }
    if (!state.settings.fontSizeCustomized) {
      state.settings.baseFontSize = recommendedFontSize();
      el.baseFontSize.value = state.settings.baseFontSize;
      saveState(false);
    }
    renderPreview();
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("visible");
    toastTimer = setTimeout(() => el.toast.classList.remove("visible"), 2400);
  }

  function openBrowserPrint() {
    clearSelection();
    renderAllPrintPages();
    requestAnimationFrame(() => window.print());
  }

  function requestPrint() {
    if (sourceItems.length === 0) {
      showToast("먼저 인쇄할 라벨 내용을 입력해 주세요.");
      el.labelInput.focus();
      return;
    }
    el.printGuideDialog.showModal();
  }

  function appendSuffixToAll() {
    if (sourceItems.length === 0) {
      showToast("먼저 라벨 내용을 입력해 주세요.");
      el.labelInput.focus();
      return;
    }
    el.labelInput.value = el.labelInput.value
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trimEnd();
        if (!trimmed || trimmed.endsWith("~")) return trimmed;
        return `${trimmed} ~`;
      })
      .join("\n");
    syncFromText();
    showToast("모든 라벨 끝에 ~를 붙였습니다.");
  }

  function toggleDuplicateEach() {
    state.duplicateEach = !state.duplicateEach;
    rebuildItems();
    clearSelection();
    currentPage = 0;
    updateDuplicateToggle();
    saveState(false);
    renderPreview();
    showToast(state.duplicateEach
      ? "각 라벨을 순서대로 2개씩 채웁니다."
      : "각 라벨을 1개씩 채웁니다.");
  }

  function selectAllOverflowing() {
    if (overflowingItemIndices.size < 2) return;
    selectedItemIndices = new Set(overflowingItemIndices);
    const visibleOverflow = [...el.previewSheetWrap.querySelectorAll(".label-cell.has-content")]
      .map((cell) => Number(cell.dataset.itemIndex))
      .find((itemIndex) => overflowingItemIndices.has(itemIndex));
    activeItemIndex = visibleOverflow ?? [...overflowingItemIndices][0];
    selectionAnchorIndex = activeItemIndex;
    el.previewStage.focus({ preventScroll: true });
    renderPreview();
  }

  function bindEvents() {
    el.labelInput.addEventListener("input", syncFromText);
    el.appendSuffixButton.addEventListener("click", appendSuffixToAll);
    el.duplicateToggle.addEventListener("click", toggleDuplicateEach);
    el.selectOverflowButton.addEventListener("click", selectAllOverflowing);
    el.previewStage.addEventListener("click", (event) => {
      if (event.target.closest(".label-cell.has-content") || selectedItemIndices.size === 0) return;
      clearSelection();
      renderPreview();
    });
    el.previewStage.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "a") return;
      event.preventDefault();
      selectedItemIndices = new Set(items.map((_, index) => index));
      selectionAnchorIndex = items.length > 0 ? 0 : null;
      activeItemIndex = null;
      for (let slot = 0; slot < 36; slot += 1) {
        const itemIndex = itemIndexForSlot(currentPage, slot);
        if (itemIndex !== null) {
          activeItemIndex = itemIndex;
          break;
        }
      }
      renderPreview();
    });
    el.startPosition.addEventListener("change", () => {
      state.startPosition = Number(el.startPosition.value);
      currentPage = 0;
      clearSelection();
      saveState(false);
      renderPreview();
    });
    el.prevPage.addEventListener("click", () => { currentPage -= 1; clearSelection(); renderPreview(); });
    el.nextPage.addEventListener("click", () => { currentPage += 1; clearSelection(); renderPreview(); });
    el.clearButton.addEventListener("click", () => {
      if (!el.labelInput.value || !window.confirm("입력한 라벨 내용을 모두 지울까요?")) return;
      el.labelInput.value = "";
      state.sizeAdjustments = {};
      syncFromText();
      el.labelInput.focus();
    });
    el.settingsButton.addEventListener("click", () => el.settingsDialog.showModal());
    el.fontChoice.addEventListener("change", () => {
      if (el.fontChoice.value === "scan-fonts") {
        scanLocalFonts();
        return;
      }
      syncSettings({ fontChanged: true });
    });
    el.numberingOrderInputs.forEach((input) => input.addEventListener("change", () => {
      syncSettings();
      clearSelection();
      currentPage = 0;
      renderStartPositionOptions();
      renderPreview();
    }));
    el.baseFontSize.addEventListener("input", () => syncSettings({ fontSizeChanged: true }));
    el.baseFontSize.addEventListener("change", () => syncSettings({ fontSizeChanged: true }));
    el.persistText.addEventListener("change", () => {
      syncSettings();
      showToast(el.persistText.checked
        ? "입력 내용을 이 브라우저에 자동 저장합니다."
        : "입력 내용 자동 저장을 껐습니다. 저장되어 있던 입력 내용도 삭제했습니다.");
    });
    [el.leftPadding, el.offsetX, el.offsetY].forEach((control) => {
      control.addEventListener("input", () => syncSettings());
      control.addEventListener("change", () => syncSettings());
    });
    el.resetSettings.addEventListener("click", () => {
      state.settings = structuredClone(DEFAULTS.settings);
      state.settings.baseFontSize = recommendedFontSize();
      state.sizeAdjustments = {};
      el.fontChoice.value = state.settings.fontChoice;
      setNumberingOrderControl(state.settings.numberingOrder);
      renderStartPositionOptions();
      el.baseFontSize.value = state.settings.baseFontSize;
      el.persistText.checked = state.settings.persistText;
      el.leftPadding.value = state.settings.leftPadding;
      el.offsetX.value = state.settings.offsetX;
      el.offsetY.value = state.settings.offsetY;
      saveState(false);
      renderPreview();
      showToast("기본 설정으로 복원했습니다.");
    });
    el.settingsDialog.addEventListener("click", (event) => {
      if (event.target === el.settingsDialog) el.settingsDialog.close();
    });
    el.printButton.addEventListener("click", requestPrint);
    el.cancelPrintGuide.addEventListener("click", () => el.printGuideDialog.close());
    el.openPrintDialog.addEventListener("click", () => {
      el.printGuideDialog.close();
      openBrowserPrint();
    });
    el.printGuideDialog.addEventListener("click", (event) => {
      if (event.target === el.printGuideDialog) el.printGuideDialog.close();
    });
    window.addEventListener("beforeprint", renderAllPrintPages);
    window.addEventListener("resize", fitPreview);
  }

  populateControls();
  bindEvents();
  renderPreview();
  detectHyFont();
})();
