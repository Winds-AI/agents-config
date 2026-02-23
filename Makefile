.PHONY: sync sync-force

sync:
	./scripts/sync-upstreams.sh

sync-force:
	./scripts/sync-upstreams.sh --force
