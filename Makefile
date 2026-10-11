# WRT: one-command bring-up (spec §7.7): make up && make seed && make dev
.PHONY: help install up down deploy identities seed seed-demo dev backend frontend build test scenarios tamper

help:
	@echo "make install     install all workspace dependencies"
	@echo "make up          network: CAs, orderer, 4 peers, channel, chaincode, identities + wallet"
	@echo "make seed        InitLedger + register farmers (make seed-demo adds sample data for the UI)"
	@echo "make dev         backend API (:3001) + frontend (:5173)"
	@echo "make deploy      rebuild and upgrade the chaincode"
	@echo "make test        chaincode unit tests (with coverage) + typecheck everything"
	@echo "make scenarios   run S1-S7 end to end through the API (S5 waits ~4 min)"
	@echo "make tamper R=<receiptId>   S6 tamper attempt on its own"
	@echo "make down        stop everything and delete all generated state"

install:
	pnpm install
	pnpm --filter @wrt/shared build

up: install
	cd network && ./network.sh up && ./network.sh createChannel && ./network.sh deployCC && ./network.sh registerIdentities

down:
	cd network && ./network.sh down

deploy:
	cd network && ./network.sh deployCC

identities:
	cd network && ./network.sh registerIdentities

seed:
	scripts/with-backend.sh pnpm --filter @wrt/scripts seed

seed-demo:
	scripts/with-backend.sh pnpm --filter @wrt/scripts seed:demo

dev:
	pnpm --parallel --filter @wrt/backend --filter @wrt/frontend dev

backend:
	pnpm --filter @wrt/backend dev

frontend:
	pnpm --filter @wrt/frontend dev

build:
	pnpm -r build

test:
	pnpm --filter wrt-chaincode test:coverage
	pnpm -r typecheck

scenarios:
	scripts/with-backend.sh pnpm --filter @wrt/scripts scenarios

tamper:
	scripts/demo-tamper.sh $(R)
