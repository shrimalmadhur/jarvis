.PHONY: install upgrade dev build typecheck

install:
	sudo bash scripts/install.sh

upgrade:
	bash scripts/upgrade.sh

dev:
	bun run dev

build:
	bun run build

typecheck:
	bun run tsc --noEmit
