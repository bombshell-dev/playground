<script>
  import { onMount } from 'svelte';
  const { model, lifecycle } = $props();
  let count = $state(0);
  function increment() {
    count += 1;
  }
  onMount(() => {
    lifecycle.push('mounted');
    return () => lifecycle.push('cleanup');
  });
</script>

<box title={$model.label}>
  <text>{$model.label}</text>
  <button onclick={increment}>{count}</button>
  {#each $model.items as item (item)}
    <text data-key={item}>{item}</text>
  {/each}
</box>
