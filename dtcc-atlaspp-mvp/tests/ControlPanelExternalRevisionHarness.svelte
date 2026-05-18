<script lang="ts">
  import ControlPanel from '../src/lib/ControlPanel.svelte';

  let externalDatasetChangeRevision = $state(0);

  export function bumpExternalDatasetChangeRevision() {
    externalDatasetChangeRevision += 1;
  }
</script>

<ControlPanel
  dataset={null}
  autoHide={false}
  {externalDatasetChangeRevision}
  onLoadDataset={() => {}}
  onLoadSample={() => {}}
  onClearDataset={() => {}}
  onSetColor={() => {}}
  onNext={() => {}}
/>
