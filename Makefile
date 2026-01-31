.PHONY: install upgrade dev build typecheck

install:
	sudo bash scripts/install.sh

upgrade:
	bash scripts/upgrade.sh

dev:
	pnpm dev

build:
	pnpm build

typecheck:
	npx tsc --noEmit
