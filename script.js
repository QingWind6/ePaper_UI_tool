document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const canvas = document.getElementById('ui-canvas');
    const canvasContainer = document.getElementById('canvas-container');
    const ctx = canvas.getContext('2d');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const clearBtn = document.getElementById('btn-clear');
    const deleteActionBtn = document.getElementById('btn-delete-action');
    const codeTextarea = document.getElementById('generated-code');
    const copyCodeBtn = document.getElementById('copy-code-btn');
    const bgColorPicker = document.getElementById('canvas-bg-color');
    const toolColorPicker = document.getElementById('tool-color-picker');
    const timelineTrack = document.getElementById('timeline-track');
    const timelineCursor = document.getElementById('timeline-cursor');
    const widthInput = document.getElementById('canvas-width-input');
    const heightInput = document.getElementById('canvas-height-input');
    const applySizeBtn = document.getElementById('btn-apply-size');
    const bitmapModal = document.getElementById('bitmap-modal-overlay');
    const modalWidthInput = document.getElementById('bitmap-width');
    const modalHeightInput = document.getElementById('bitmap-height');
    const modalBppSelect = document.getElementById('bitmap-bpp');
    const modalCArrayInput = document.getElementById('bitmap-c-array');
    const modalConfirmBtn = document.getElementById('modal-btn-confirm');
    const modalCancelBtn = document.getElementById('modal-btn-cancel');

    // --- State Variables ---
    let currentTool = 'select';
    let isDrawing = false;
    let startX, startY;
    let historyStack = [];
    let currentHistoryIndex = -1;
    let elements = [];
    let previewElement = null;
    let canvasBackgroundColor = '#FFFFFF'; // MODIFIED: Default background to white
    let currentDrawingColor = '#000000'; // MODIFIED: Default tool color to black
    const bitmapCache = new Map();
    let scale = 1, panX = 0, panY = 0, isPanning = false, lastPanX, lastPanY;

    // NEW: State for moving elements
    let selectedElementId = null;
    let isDraggingElement = false;
    let dragStartX, dragStartY;
    let originalElementState = null;


    // --- Utility Functions ---
    const hexToRgb = hex => /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    const rgbTo565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
    const hexTo565 = hex => {
        const rgb = hexToRgb(hex);
        return rgb ? `0x${rgbTo565(parseInt(rgb[1], 16), parseInt(rgb[2], 16), parseInt(rgb[3], 16)).toString(16).toUpperCase().padStart(4, '0')}` : '0x0000';
    };
    function getCanvasCoords(e) {
        const rect = canvasContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        return {
            x: Math.round((x - panX) / scale),
            y: Math.round((y - panY) / scale)
        };
    }
    function updateCanvasTransform() {
        canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    }

    // --- Core Logic ---
    async function rebuildStateAndRender(targetIndex) {
        currentHistoryIndex = targetIndex;
        elements = [];
        for (let i = 0; i <= targetIndex; i++) {
            const action = historyStack[i];
            if (action.type === 'add') {
                const el = JSON.parse(JSON.stringify(action.element));
                if (el.type === 'bitmap' && !bitmapCache.has(el.cArrayString)) {
                    await renderBitmap(el);
                }
                elements.push(el);
            }
        }
        updateTimelineVisuals();
        redrawCanvas();
        generateCode();
    }
    function addAction(action) {
        historyStack.splice(currentHistoryIndex + 1);
        historyStack.push(action);
        rebuildStateAndRender(historyStack.length - 1);
    }

    function drawElement(el) {
        if (!el) return;
        if (el.type === 'bitmap') {
            if (bitmapCache.has(el.cArrayString)) {
                const cacheEntry = bitmapCache.get(el.cArrayString);
                if (el.bpp === 1) {
                    const tempCanvas = document.createElement('canvas');
                    tempCanvas.width = el.w; tempCanvas.height = el.h;
                    const tempCtx = tempCanvas.getContext('2d');
                    tempCtx.fillStyle = el.color;
                    tempCtx.fillRect(0, 0, el.w, el.h);
                    tempCtx.globalCompositeOperation = 'destination-in';
                    tempCtx.drawImage(cacheEntry, 0, 0);
                    ctx.drawImage(tempCanvas, el.x, el.y);
                } else {
                    ctx.drawImage(cacheEntry, el.x, el.y);
                }
            }
            return;
        }

        ctx.fillStyle = el.color || '#000000';
        ctx.strokeStyle = el.color || '#000000';
        switch (el.type) {
            case 'pixel': ctx.fillRect(el.x, el.y, 1, 1); break;
            case 'line': ctx.beginPath(); ctx.moveTo(el.x1, el.y1); ctx.lineTo(el.x2, el.y2); ctx.stroke(); break;
            case 'rect': ctx.strokeRect(el.x, el.y, el.w, el.h); break;
            case 'fill-rect': ctx.fillRect(el.x, el.y, el.w, el.h); break;
            case 'circle': ctx.beginPath(); ctx.arc(el.x, el.y, el.r, 0, Math.PI * 2); ctx.stroke(); break;
            case 'fill-circle': ctx.beginPath(); ctx.arc(el.x, el.y, el.r, 0, Math.PI * 2); ctx.fill(); break;
            case 'text':
                const fontSize = parseInt(el.font.match(/\d+/)[0] || 10);
                ctx.font = `${fontSize}px monospace`;
                ctx.textBaseline = "top";
                ctx.fillText(el.text, el.x, el.y);
                break;
        }
    }
    
    // NEW: Draw selection highlight
    function drawSelectionHighlight() {
        if (!selectedElementId) return;
        const el = elements.find(e => e.id === selectedElementId);
        if (!el) return;

        let x, y, w, h;
        const padding = 5;

        switch (el.type) {
            case 'line':
                x = Math.min(el.x1, el.x2) - padding;
                y = Math.min(el.y1, el.y2) - padding;
                w = Math.abs(el.x1 - el.x2) + padding * 2;
                h = Math.abs(el.y1 - el.y2) + padding * 2;
                break;
            case 'circle':
            case 'fill-circle':
                x = el.x - el.r - padding;
                y = el.y - el.r - padding;
                w = el.r * 2 + padding * 2;
                h = el.r * 2 + padding * 2;
                break;
            case 'pixel':
                 x = el.x - padding;
                 y = el.y - padding;
                 w = padding * 2;
                 h = padding * 2;
                 break;
            case 'text':
                const fontSize = parseInt(el.font.match(/\d+/)[0] || 10);
                ctx.font = `${fontSize}px monospace`;
                const metrics = ctx.measureText(el.text);
                x = el.x - padding;
                y = el.y - padding;
                w = metrics.width + padding * 2;
                h = fontSize * 1.2 + padding * 2;
                break;
            default: // rect, fill-rect, bitmap
                x = el.x - padding;
                y = el.y - padding;
                w = el.w + padding * 2;
                h = el.h + padding * 2;
                break;
        }

        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
    }

    function redrawCanvas() {
        ctx.fillStyle = canvasBackgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        elements.forEach(drawElement);
        drawSelectionHighlight(); // NEW: Draw highlight
    }
    function redrawCanvasWithPreview() {
        redrawCanvas();
        if (previewElement) drawElement(previewElement);
    }

    function generateCode() {
        let bitmapDefinitions = '';
        const bitmapMap = new Map();
        const header = `// Code generated for TFT_eSPI (${canvas.width}x${canvas.height})\n#include <TFT_eSPI.h>\n#include <U8g2_for_TFT_eSPI.h>\n`;

        let body = elements.map((el, index) => {
            if (el.type === 'bitmap') {
                if (!bitmapMap.has(el.cArrayString)) {
                    const varName = `bitmap_${el.id}`;
                    bitmapMap.set(el.cArrayString, varName);
                    const dataType = el.bpp === 1 ? 'const unsigned char' : 'const uint16_t';
                    const cArrayContent = el.cArrayString.substring(el.cArrayString.indexOf('{'), el.cArrayString.lastIndexOf('}') + 1);
                    bitmapDefinitions += `\n// Bitmap Data for element #${index + 1}\n`;
                    bitmapDefinitions += `${dataType} ${varName}[] PROGMEM = ${cArrayContent};\n`;
                }
                const varName = bitmapMap.get(el.cArrayString);
                if (el.bpp === 1) {
                    return `    tft.drawBitmap(${el.x}, ${el.y}, ${varName}, ${el.w}, ${el.h}, ${hexTo565(el.color)});`;
                } else {
                    return `    tft.pushImage(${el.x}, ${el.y}, ${el.w}, ${el.h}, ${varName});`;
                }
            }
            
            const color565 = hexTo565(el.color);
            switch (el.type) {
                case 'pixel': return `    tft.drawPixel(${el.x}, ${el.y}, ${color565});`;
                case 'line': return `    tft.drawLine(${el.x1}, ${el.y1}, ${el.x2}, ${el.y2}, ${color565});`;
                case 'rect': return `    tft.drawRect(${el.x}, ${el.y}, ${el.w}, ${el.h}, ${color565});`;
                case 'fill-rect': return `    tft.fillRect(${el.x}, ${el.y}, ${el.w}, ${el.h}, ${color565});`;
                case 'circle': return `    tft.drawCircle(${el.x}, ${el.y}, ${el.r}, ${color565});`;
                case 'fill-circle': return `    tft.fillCircle(${el.x}, ${el.y}, ${el.r}, ${color565});`;
                case 'text':
                    const ascent = Math.round(parseInt(el.font.match(/\d+/)[0] || 10) * 0.8);
                    return `\n    // Text: "${el.text}"\n` +
                           `    u8g2_for_tft_eSPI.setForegroundColor(${color565});\n` +
                           `    u8g2_for_tft_eSPI.setFont(${el.font});\n` +
                           `    u8g2_for_tft_eSPI.drawUTF8(${el.x}, ${el.y + ascent}, "${el.text}");`;
            }
        }).join('\n');
        
        const mainFunctions = `
TFT_eSPI tft = TFT_eSPI();
U8g2_for_TFT_eSPI u8g2_for_tft_eSPI;

void setup() {
    tft.begin();
    tft.setRotation(1);
    u8g2_for_tft_eSPI.begin(tft);
    u8g2_for_tft_eSPI.setFontMode(1);
    u8g2_for_tft_eSPI.setFontDirection(0);
    drawUI();
}

void drawUI() {
    tft.fillScreen(${hexTo565(canvasBackgroundColor)});
${body}
}

void loop() { delay(1000); }`;
        codeTextarea.value = header + bitmapDefinitions + mainFunctions;
    }
    
    function updateTimelineVisuals() {
        timelineTrack.innerHTML = '';
        const stepWidth = 37;
        historyStack.forEach((action, index) => {
            const item = document.createElement('div');
            item.className = 'history-item';
            if (index === currentHistoryIndex) item.classList.add('active');
            item.dataset.index = index;
            const toolType = action.element.type.replace('fill-', '');
            const iconSource = document.querySelector(`#tool-${toolType} svg`);
            if (iconSource) item.appendChild(iconSource.cloneNode(true));
            timelineTrack.appendChild(item);
        });
        const cursorLeft = (currentHistoryIndex + 1) * stepWidth - 5;
        timelineCursor.style.left = `${cursorLeft}px`;
    }

    function fitCanvasToContainer() {
        const containerRect = canvasContainer.getBoundingClientRect();
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        const scaleX = containerRect.width / canvasWidth;
        const scaleY = containerRect.height / canvasHeight;
        scale = Math.min(scaleX, scaleY) * 0.95;
        panX = (containerRect.width - canvasWidth * scale) / 2;
        panY = (containerRect.height - canvasHeight * scale) / 2;
        updateCanvasTransform();
    }

    function setCanvasSize(width, height) {
         if (confirm(`确定要将画布尺寸设为 ${width}x${height} 吗？\n这将清除所有当前内容和历史记录。`)) {
            canvas.width = width;
            canvas.height = height;
            historyStack = [];
            selectedElementId = null;
            rebuildStateAndRender(-1);
            fitCanvasToContainer();
         } else {
             widthInput.value = canvas.width;
             heightInput.value = canvas.height;
         }
    }
    
    // --- Bitmap Handling ---
    function parseBitmapCArray(fullString) {
        try {
            const dataStr = fullString.substring(fullString.indexOf('{') + 1, fullString.lastIndexOf('}'));
            if (!dataStr) return null;
            const numbers = dataStr.match(/0x[0-9a-fA-F]+|\d+/g);
            return numbers.map(num => parseInt(num));
        } catch (e) {
            console.error("C array parsing error:", e);
            return null;
        }
    }

    async function renderBitmap(element) {
        const { w, h, bpp, cArrayString } = element;
        const pixelData = parseBitmapCArray(cArrayString);

        if (!pixelData) {
            alert(`位图数据解析失败：请检查数组格式。`);
            return Promise.reject("Parsing failed");
        }
        
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = w;
        offscreenCanvas.height = h;
        const offCtx = offscreenCanvas.getContext('2d');
        const imageData = offCtx.createImageData(w, h);

        if (bpp === 1) { 
            const bytesPerRow = Math.ceil(w / 8);
            if (pixelData.length < bytesPerRow * (h - 1) + Math.floor(w/8) ) {
                alert(`1 BPP位图数据错误：期望至少 ${bytesPerRow * h} 字节，但解析到了 ${pixelData.length} 字节。`);
                return Promise.reject("Data length mismatch");
            }
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const byteIndex = y * bytesPerRow + Math.floor(x / 8);
                    const bitIndex = 7 - (x % 8);
                    const isPixelSet = (pixelData[byteIndex] >> bitIndex) & 1;
                    if (isPixelSet) {
                        const canvasPixelIndex = (y * w + x) * 4;
                        imageData.data[canvasPixelIndex + 0] = 255;
                        imageData.data[canvasPixelIndex + 1] = 255;
                        imageData.data[canvasPixelIndex + 2] = 255;
                        imageData.data[canvasPixelIndex + 3] = 255;
                    }
                }
            }
        } else if (bpp === 16) { 
             if (pixelData.length !== w * h) {
                alert(`16 BPP位图数据错误：期望 ${w * h} 个像素点，但解析到了 ${pixelData.length} 个。`);
                return Promise.reject("Data length mismatch");
            }
            for (let i = 0; i < pixelData.length; i++) {
                const val = pixelData[i];
                const r = (val >> 11) & 0x1F, g = (val >> 5) & 0x3F, b = val & 0x1F;
                imageData.data[i * 4 + 0] = (r * 255) / 31;
                imageData.data[i * 4 + 1] = (g * 255) / 63;
                imageData.data[i * 4 + 2] = (b * 255) / 31;
                imageData.data[i * 4 + 3] = 255;
            }
        } else {
            alert("目前只支持 1 BPP 或 16 BPP 的位图。");
            return Promise.reject("Unsupported BPP");
        }
        offCtx.putImageData(imageData, 0, 0);
        bitmapCache.set(cArrayString, offscreenCanvas);
        return Promise.resolve();
    }
    
    function showBitmapModal() { bitmapModal.style.display = 'flex'; }
    function hideBitmapModal() { bitmapModal.style.display = 'none'; }

    // --- NEW: Element Selection & Hit Detection ---
    function distSq(v, w) { return (v.x - w.x)**2 + (v.y - w.y)**2; }
    function distToSegmentSq(p, v, w) {
        const l2 = distSq(v, w);
        if (l2 === 0) return distSq(p, v);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return distSq(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
    }

    function getElementAtCoords({ x, y }) {
        for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            const tolerance = 5; // 5px tolerance for selection
            let hit = false;
            switch (el.type) {
                case 'pixel':
                    hit = x >= el.x - 2 && x <= el.x + 2 && y >= el.y - 2 && y <= el.y + 2;
                    break;
                case 'rect': case 'fill-rect': case 'bitmap':
                    hit = x >= el.x && x <= el.x + el.w && y >= el.y && y <= el.y + el.h;
                    break;
                case 'text':
                    const fontSize = parseInt(el.font.match(/\d+/)[0] || 10);
                    ctx.font = `${fontSize}px monospace`;
                    const metrics = ctx.measureText(el.text);
                    const textHeight = fontSize * 1.2;
                    hit = x >= el.x && x <= el.x + metrics.width && y >= el.y && y <= el.y + textHeight;
                    break;
                case 'circle': case 'fill-circle':
                    hit = Math.sqrt((x - el.x)**2 + (y - el.y)**2) <= el.r;
                    break;
                case 'line':
                    hit = distToSegmentSq({x, y}, {x: el.x1, y: el.y1}, {x: el.x2, y: el.y2}) < tolerance**2;
                    break;
            }
            if (hit) return el;
        }
        return null;
    }

    // --- Event Listeners ---
    toolBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const toolId = btn.id.replace('tool-', '');
            if (toolId === 'bitmap') {
                showBitmapModal();
                return;
            }
            if (currentTool === 'place-bitmap') {
                previewElement = null;
                redrawCanvas();
            }
            currentTool = toolId;
            toolBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            canvasContainer.style.cursor = toolId === 'select' ? 'grab' : 'crosshair';
            if (toolId !== 'select') { // Deselect element when switching tool
                selectedElementId = null;
                redrawCanvas();
            }
        });
    });

    modalConfirmBtn.addEventListener('click', async () => {
        const w = parseInt(modalWidthInput.value);
        const h = parseInt(modalHeightInput.value);
        const bpp = parseInt(modalBppSelect.value);
        const cArrayString = modalCArrayInput.value;

        if (!w || !h || !bpp || !cArrayString) {
            alert("所有字段均为必填项。");
            return;
        }
        hideBitmapModal();
        const newElement = { id: Date.now(), type: 'bitmap', w, h, bpp, cArrayString, color: currentDrawingColor };
        try {
            await renderBitmap(newElement);
            previewElement = newElement;
            currentTool = 'place-bitmap';
            canvasContainer.style.cursor = 'copy';
        } catch (e) {
            previewElement = null;
            currentTool = 'select';
        }
    });
    modalCancelBtn.addEventListener('click', hideBitmapModal);
    bitmapModal.addEventListener('click', (e) => {
        if (e.target === bitmapModal) hideBitmapModal();
    });

    deleteActionBtn.addEventListener('click', () => {
        if (currentHistoryIndex === -1) {
            alert("没有选中的历史记录可以删除。");
            return;
        }
        if (confirm(`确定要删除选中的第 ${currentHistoryIndex + 1} 个操作吗？`)) {
            if (historyStack[currentHistoryIndex].element.id === selectedElementId) {
                selectedElementId = null;
            }
            historyStack.splice(currentHistoryIndex, 1);
            rebuildStateAndRender(currentHistoryIndex - 1);
        }
    });
    
    bgColorPicker.addEventListener('input', (e) => {
        canvasBackgroundColor = e.target.value;
        redrawCanvas();
        generateCode();
    });
    toolColorPicker.addEventListener('input', (e) => { currentDrawingColor = e.target.value; });
    clearBtn.addEventListener('click', () => {
        if (confirm('确定要清空画布吗？这将清除所有历史记录。')) {
            historyStack = [];
            selectedElementId = null;
            rebuildStateAndRender(-1);
        }
    });
    copyCodeBtn.addEventListener('click', () => {
        codeTextarea.select();
        document.execCommand('copy');
    });
    applySizeBtn.addEventListener('click', () => {
        const newWidth = parseInt(widthInput.value);
        const newHeight = parseInt(heightInput.value);
        if (newWidth > 0 && newHeight > 0) setCanvasSize(newWidth, newHeight);
        else alert('无效的画布尺寸。');
    });

    // --- MODIFIED: Canvas & Viewport Interaction ---
    canvasContainer.addEventListener('mousedown', (e) => {
        const coords = getCanvasCoords(e);
        if (e.button === 2) { // Right click to pan
            isPanning = true;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            canvasContainer.style.cursor = 'grabbing';
            return;
        }

        if (currentTool === 'place-bitmap' && previewElement) {
            previewElement.x = coords.x;
            previewElement.y = coords.y;
            addAction({ type: 'add', element: { ...previewElement } });
            previewElement = null;
            document.querySelector('#tool-select').click();
            return;
        }
        
        if (currentTool === 'select') {
            const foundElement = getElementAtCoords(coords);
            if (foundElement) {
                isDraggingElement = true;
                selectedElementId = foundElement.id;
                const newHistoryIndex = historyStack.findIndex(action => action.element.id === selectedElementId);
                if (newHistoryIndex !== -1) currentHistoryIndex = newHistoryIndex;
                
                dragStartX = coords.x;
                dragStartY = coords.y;
                originalElementState = JSON.parse(JSON.stringify(foundElement));
                
                updateTimelineVisuals();
                redrawCanvas();
            } else {
                selectedElementId = null;
                redrawCanvas();
            }
            return;
        }

        isDrawing = true;
        startX = coords.x;
        startY = coords.y;
        selectedElementId = null; // Deselect when drawing
        previewElement = { id: Date.now(), color: currentDrawingColor };
        switch(currentTool) {
            case 'pixel': previewElement = { ...previewElement, type: 'pixel', x: startX, y: startY }; break;
            case 'line': previewElement = { ...previewElement, type: 'line', x1: startX, y1: startY, x2: startX, y2: startY }; break;
            case 'rect': case 'fill-rect': previewElement = { ...previewElement, type: currentTool, x: startX, y: startY, w: 0, h: 0 }; break;
            case 'circle': case 'fill-circle': previewElement = { ...previewElement, type: currentTool, x: startX, y: startY, r: 0 }; break;
            case 'text': previewElement = { ...previewElement, type: 'text', x: startX, y: startY, text: 'Hello', font: 'u8g2_font_ncenB12_tr'}; break;
            default: isDrawing = false; previewElement = null; return;
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = e.clientX - lastPanX;
            const dy = e.clientY - lastPanY;
            panX += dx;
            panY += dy;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            updateCanvasTransform();
            return;
        }

        // NEW: Handle element dragging
        if (isDraggingElement && selectedElementId && originalElementState) {
            const coords = getCanvasCoords(e);
            const dx = coords.x - dragStartX;
            const dy = coords.y - dragStartY;
            const elementToMove = elements.find(el => el.id === selectedElementId);
            if (!elementToMove) return;

            if (elementToMove.type === 'line') {
                elementToMove.x1 = originalElementState.x1 + dx;
                elementToMove.y1 = originalElementState.y1 + dy;
                elementToMove.x2 = originalElementState.x2 + dx;
                elementToMove.y2 = originalElementState.y2 + dy;
            } else {
                elementToMove.x = originalElementState.x + dx;
                elementToMove.y = originalElementState.y + dy;
            }
            redrawCanvas();
            return;
        }

        if (currentTool === 'place-bitmap' && previewElement) {
            const coords = getCanvasCoords(e);
            previewElement.x = coords.x;
            previewElement.y = coords.y;
            redrawCanvasWithPreview();
            return;
        }
        if (!isDrawing || !previewElement) return;
        const coords = getCanvasCoords(e);
        const currentX = coords.x;
        const currentY = coords.y;
        switch(previewElement.type) {
            case 'line': previewElement.x2 = currentX; previewElement.y2 = currentY; break;
            case 'rect': case 'fill-rect':
                previewElement.x = Math.min(startX, currentX);
                previewElement.y = Math.min(startY, currentY);
                previewElement.w = Math.abs(startX - currentX);
                previewElement.h = Math.abs(startY - currentY);
                break;
            case 'circle': case 'fill-circle':
                const dx = currentX - startX;
                const dy = currentY - startY;
                previewElement.r = Math.round(Math.sqrt(dx*dx + dy*dy));
                break;
        }
        redrawCanvasWithPreview();
    });
    
    let isDraggingCursor = false;
    document.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
            canvasContainer.style.cursor = currentTool === 'select' ? 'grab' : 'crosshair';
        }
        // NEW: Handle end of element drag
        if (isDraggingElement) {
            isDraggingElement = false;
            const movedElement = elements.find(el => el.id === selectedElementId);
            if (movedElement) {
                const actionToUpdate = historyStack.find(action => action.element.id === selectedElementId);
                if (actionToUpdate) {
                    actionToUpdate.element = JSON.parse(JSON.stringify(movedElement));
                }
            }
            originalElementState = null;
            generateCode();
            redrawCanvas();
        }

        if (isDraggingCursor) isDraggingCursor = false;
        if (!isDrawing || !previewElement) {
            isDrawing = false;
            return;
        }
        isDrawing = false;
        if (previewElement.type === 'text') {
            const text = prompt("输入文字:", previewElement.text);
            if (text) previewElement.text = text;
            else previewElement = null;
        }
        if (previewElement && ((previewElement.w === 0 && previewElement.h === 0) || previewElement.r === 0)) {
            if(previewElement.type !== 'pixel' && previewElement.type !== 'text') previewElement = null;
        }
        if (previewElement) addAction({ type: 'add', element: { ...previewElement } });
        previewElement = null;
    });

    canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1.1;
        const rect = canvasContainer.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const oldScale = scale;
        if (e.deltaY < 0) {
            scale *= zoomFactor;
        } else {
            scale /= zoomFactor;
        }
        panX = mouseX - ((mouseX - panX) * (scale / oldScale));
        panY = mouseY - ((mouseY - panY) * (scale / oldScale));
        updateCanvasTransform();
    });
    canvasContainer.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // MODIFIED: Timeline interaction to select elements
    timelineTrack.addEventListener('click', (e) => {
        const historyItem = e.target.closest('.history-item');
        if (historyItem) {
            const index = parseInt(historyItem.dataset.index);
            rebuildStateAndRender(index);
            if (historyStack[index]) {
                selectedElementId = historyStack[index].element.id;
                redrawCanvas(); // Redraw to show selection
            } else {
                selectedElementId = null;
            }
        }
    });
    
    timelineCursor.addEventListener('mousedown', () => isDraggingCursor = true);
    document.addEventListener('mousemove', (e) => {
        if (isPanning || isDrawing || !isDraggingCursor || isDraggingElement) return;
        const rect = timelineTrack.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const stepWidth = 37;
        let index = Math.round(x / stepWidth) - 1;
        index = Math.max(-1, Math.min(historyStack.length - 1, index));
        if (index !== currentHistoryIndex) {
             rebuildStateAndRender(index);
             selectedElementId = null; // Deselect when scrubbing timeline
        }
    });
    
    // NEW: Add hover effect for select tool
    canvasContainer.addEventListener('mousemove', (e) => {
        if (currentTool === 'select' && !isPanning && !isDraggingElement) {
            const coords = getCanvasCoords(e);
            const elementUnderMouse = getElementAtCoords(coords);
            canvasContainer.style.cursor = elementUnderMouse ? 'move' : 'grab';
        }
    });

    // --- Initial Load ---
    window.addEventListener('resize', fitCanvasToContainer);
    canvas.width = parseInt(widthInput.value);
    canvas.height = parseInt(heightInput.value);
    rebuildStateAndRender(-1);
    fitCanvasToContainer();
});