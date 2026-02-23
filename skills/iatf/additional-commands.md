# IATF Additional Commands

Use these for operational workflows beyond core retrieval/edit loops.

## Index Variant

```bash
iatf index <file> --with-dates
```

## Batch Rebuild

```bash
iatf rebuild-all [directory]
```

## Watch Commands

```bash
iatf watch <file> [--debug]
iatf watch-dir <dir> [--debug]
iatf unwatch <file>
iatf watch --list
```

## Daemon Commands

```bash
iatf daemon start [--debug]
iatf daemon stop
iatf daemon status
iatf daemon run [--debug]
iatf daemon install
iatf daemon uninstall
```

## Utility Commands

```bash
iatf --help
iatf --version
```
