# Upstream References

This repo keeps external open-source references out of version control while still making them easy to clone and refresh.

## Files

- `upstreams.tsv`: manifest of upstream repos
- `scripts/sync-upstreams.sh`: clone/update tool
- `Makefile`: convenience targets

## Manifest Format

`upstreams.tsv` is tab-separated:

`name<TAB>repo_url<TAB>branch<TAB>target_dir`

## Usage

Clone your main repo, then run:

```bash
make sync
```

This will:
- clone missing upstream repos
- fast-forward existing repos to the latest remote branch
- skip dirty repos (to avoid losing local changes)

To force-reset upstream repos to remote HEAD:

```bash
make sync-force
```
