"""
把 assets/original-image..png 处理成带透明底的 character.png，
供桌宠窗口直接作为位图渲染使用。

处理步骤：
1. 从四周开始 Flood Fill，把接近纯黑的背景移除（保留黑色头发）。
2. 裁剪到内容外接矩形并留少量边距。
3. 缩放到合适的高清尺寸（默认高度 900），保持比例。
"""

import os
import sys
from collections import deque
from PIL import Image
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_PATH = os.path.join(ROOT, 'assets', 'original-image..png')
OUT_PATH = os.path.join(ROOT, 'assets', 'character.png')

# 背景色阈值：R/G/B 都小于这个值视为背景。
# 原图背景是纯黑，头发虽然黑但不是纯黑，保留它。
BG_THRESHOLD = 22

# 输出高度（保持比例）
TARGET_HEIGHT = 900

# 裁剪边距（像素，基于输出尺寸）
PADDING = 12


def remove_background(arr):
    h, w = arr.shape[:2]
    max_rgb = arr[:, :, :3].max(axis=2)
    is_bg = max_rgb < BG_THRESHOLD

    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    def push(x, y):
        if 0 <= x < w and 0 <= y < h and not visited[y, x] and is_bg[y, x]:
            visited[y, x] = True
            q.append((x, y))

    # 从四条边开始
    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        push(x + 1, y)
        push(x - 1, y)
        push(x, y + 1)
        push(x, y - 1)

    # 把背景置为透明
    arr = arr.copy()
    arr[visited] = [0, 0, 0, 0]

    # 去除极淡的残余杂点，并反乘黑色背景造成的边缘发灰
    alpha = arr[:, :, 3]
    low_alpha = alpha < 25
    arr[low_alpha] = [0, 0, 0, 0]

    edge_mask = (alpha > 0) & (alpha < 255)
    scale = 255.0 / alpha[edge_mask]
    arr[edge_mask, :3] = np.clip(arr[edge_mask, :3] * scale[:, None], 0, 255).astype(np.uint8)
    return arr


def main():
    if not os.path.exists(SRC_PATH):
        print(f'找不到原图：{SRC_PATH}', file=sys.stderr)
        sys.exit(1)

    img = Image.open(SRC_PATH).convert('RGBA')
    arr = np.array(img)

    print('正在去除黑色背景…')
    arr = remove_background(arr)

    # 找到非透明区域
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if len(xs) == 0:
        print('未能识别到角色内容，请检查原图。', file=sys.stderr)
        sys.exit(1)

    min_x, max_x = int(xs.min()), int(xs.max())
    min_y, max_y = int(ys.min()), int(ys.max())

    # 加入边距后裁剪
    min_x = max(0, min_x - PADDING)
    min_y = max(0, min_y - PADDING)
    max_x = min(arr.shape[1] - 1, max_x + PADDING)
    max_y = min(arr.shape[0] - 1, max_y + PADDING)

    cropped = arr[min_y:max_y + 1, min_x:max_x + 1]

    # 缩放
    h, w = cropped.shape[:2]
    scale = TARGET_HEIGHT / h
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    out_img = Image.fromarray(cropped, 'RGBA').resize((new_w, new_h), Image.LANCZOS)

    out_img.save(OUT_PATH, 'PNG')
    print(f'已生成角色图：{OUT_PATH}（{new_w}x{new_h}）')


if __name__ == '__main__':
    main()
