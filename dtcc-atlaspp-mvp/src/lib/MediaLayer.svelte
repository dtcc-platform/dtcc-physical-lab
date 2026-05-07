<script lang="ts">
  import type { DatasetContent } from './storage';

  type MediaFrame = { x: number; y: number; width: number; height: number };

  let { content, frame } = $props<{
    content: Extract<DatasetContent, { kind: 'image' | 'video' }>;
    frame: MediaFrame;
  }>();

  const style = $derived(
    `left: ${frame.x}px; top: ${frame.y}px; width: ${frame.width}px; height: ${frame.height}px; object-fit: fill;`
  );
</script>

{#if content.kind === 'image'}
  <img
    class="absolute pointer-events-none select-none"
    src={content.src}
    alt=""
    style={style}
    draggable="false"
  />
{:else}
  <video
    class="absolute pointer-events-none select-none"
    src={content.src}
    style={style}
    muted={content.muted}
    autoplay={content.autoplay}
    loop={content.loop}
    playsinline
  ></video>
{/if}
