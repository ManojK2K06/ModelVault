# ModelVault

A local model analysis tool for scanning, signing, and sandbox-testing ML model files. ModelVault runs entirely on your machine -- no cloud services, no external authentication, no billing. Upload model files in common formats, run binary-level security scans, generate software bills of materials, cryptographically sign models with Ed25519, and test them in a local Python sandbox before publishing to policy-gated registries.

---

## Architecture

```
                    +-----------------+
                    |   Browser (SPA) |
                    |  Next.js Client |
                    +--------+--------+
                             |
                     HTTP / JSON API
                             |
                    +--------v--------+
                    |  Next.js Server |
                    |   App Router    |
                    +--------+--------+
                             |
              +--------------+--------------+---------------+
              |              |              |               |
     +--------v---+  +------v-----+  +------v----+  +------v------+
     |   Scanner   |  |  Signing   |  |  Sandbox  |  |  Audit Log  |
     |  (TypeScript)|  |  (Ed25519) |  | (Python3) |  |   Logger   |
     +--------+---+  +------+------+  +------+----+  +------+------+
              |              |              |               |
     +--------v---+  +------v-----+        |        +------v------+
     |    SBOM     |  |  Key Files |        |        |  AuditLog   |
     |  Generator  |  | (PEM on    |        |        |   Table     |
     +--------+---+  |  disk)     |        |        +------+------+
              |       +------------+        |               |
     +--------v---+                         |               |
     |  CycloneDX  |                        |               |
     |  ML-BOM DB  |                        |               |
     +-----+------+                        |               |
           |                               |               |
           +-------+---------------+-------+---------------+
                   |               |
            +------v------+  +-----v------+
            |  SQLite DB  |  |  Local FS  |
            |  (Prisma)   |  | (uploads/) |
            +-------------+  +------------+
```

### Component Breakdown

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js App Router, React 19, Tailwind CSS 4, shadcn/ui, Zustand | Single-page application with client-side navigation |
| **API Layer** | Next.js Route Handlers | RESTful JSON endpoints under `/api/` |
| **Scanner** | TypeScript (Node.js `Buffer`) | Binary format detection and parsing for SafeTensors, GGUF, ONNX, and PyTorch files |
| **SBOM Generator** | TypeScript | Produces CycloneDX ML-BOM JSON with dependency and vulnerability extraction |
| **Signing** | Node.js `crypto` (Ed25519) | Key pair generation, SHA-256 hash signing, and signature verification |
| **Sandbox** | Python 3 subprocess | Local execution environment with security probes |
| **Database** | SQLite via Prisma ORM | Persistent storage for models, versions, signatures, SBOMs, jobs, registries, audit logs |
| **Storage** | Local filesystem (`uploads/`) | Model file storage with org-scoped directory hierarchy |
| **Policy Gates** | OPA/Rego (evaluated in-process) | Registry publish policies defined as Rego rules |

---

## Core Features

### Model Upload and Storage

Models are uploaded via multipart form data. The API extracts the file buffer, computes SHA-256 and SHA-512 hashes over the full file, and builds a binary Merkle tree from 1 MB chunks. The file is stored on disk at `uploads/{orgId}/{modelId}/{versionId}/{filename}` and all hash values are persisted on the `ModelVersion` record.

### Binary Format Scanning

The scanner reads raw bytes from model files to detect format and extract metadata without executing code:

- **SafeTensors** -- Parses the 8-byte little-endian header length, reads the JSON header to extract tensor names, shapes, and data types.
- **GGUF/GGJT** -- Reads the version number, tensor count, and key-value metadata pairs from the GGUF binary format.
- **ONNX** -- Detects the ONNX protobuf magic bytes and extracts model metadata.
- **PyTorch (zip-based)** -- Detects ZIP containers (used by `.pt`, `.pth`, `.ckpt` files) and flags pickle-based deserialization risks.
- **Format mismatch detection** -- Compares the user-declared format against the magic-byte-detected format and flags discrepancies.

### SBOM Generation

After scanning, a CycloneDX ML-BOM JSON document is generated containing all extracted dependencies, frameworks, and detected components. The SBOM engine checks for known vulnerability patterns and classifies findings by severity (CRITICAL, HIGH, MEDIUM, LOW). The resulting SBOM and vulnerability counts are stored in the `Sbom` table, linked to the specific model version.

### Vulnerability Detection

ModelVault detects vulnerabilities through two complementary mechanisms: **static binary analysis** (the scanner) and **behavioral runtime analysis** (the sandbox). Every finding is recorded with a unique ID, severity level, description, and detail text.

#### Static Analysis Checks (Scanner)

These run against the raw bytes of every uploaded file during the scan stage. No code is executed -- the scanner only reads binary structures.

| Vulnerability ID | Severity | What It Detects | Detection Method |
|---|---|---|---|
| `SCAN-EMPTY-FILE` | CRITICAL | The uploaded file is zero bytes or completely empty | Checks `buffer.length === 0` before any parsing. A zero-byte file can never be a valid model -- it indicates a failed upload, a corrupted transfer, or a placeholder. |
| `SCAN-FORMAT-MISMATCH` | HIGH | The file's binary header does not match the format the user declared | Reads the first bytes of the file and compares the detected magic bytes (`GGUF`, `PK\x03\x04`, SafeTensors 8-byte header + JSON) against the user-specified format string. A mismatch means the file is mislabeled, was converted incorrectly, or is a different file disguised as a model. This is a common supply-chain attack vector. |
| `SCAN-SMALL-FILE` | MEDIUM | The file is under 1 KB -- far too small to contain meaningful model weights | Checks `buffer.length < 1024`. Real model files are at least several megabytes (even tiny models). A sub-KB file claiming to be a model is suspicious -- it could be a test file, a stub, or a social engineering probe. |
| `SCAN-LARGE-HEADER` | MEDIUM | The parsed header occupies more than 90% of the total file size | Computes `headerSizeBytes / fileSizeBytes`. A model file should be overwhelmingly tensor weight data. If the header is nearly the entire file, it means there is almost no actual model data -- the file is essentially just metadata, which is structurally anomalous. |
| `SCAN-NO-METADATA` | LOW | The file was recognized as a known format but no meaningful metadata could be extracted from the header | After format detection succeeds (e.g., SafeTensors header size parses correctly), the JSON header or binary metadata fails to contain any useful key-value pairs. The file may be structurally valid but content-empty. |

**Format-specific observations** (not raised as separate vulnerability IDs, but recorded in the SBOM metadata and available for policy evaluation):

- **PyTorch / ZIP containers** -- The parser opens the ZIP archive and lists all internal files (`config.json`, `pytorch_model.bin`, `*.pt`, `*.pth`, tokenizer files, etc.). It identifies whether the bundle uses the HuggingFace format or a raw PyTorch checkpoint. PyTorch's native `.pt`/`.pth` files use Python's `pickle` module for serialization, which is a well-documented arbitrary code execution vector -- `torch.load()` can execute any Python function during deserialization. The scanner identifies the presence of these files so the sandbox can test them.

- **GGUF** -- The parser reads the full GGUF binary structure: magic bytes, version number, tensor count, and all metadata key-value pairs (up to 500 entries). It extracts the model architecture, quantization version (indicating `llama.cpp` usage), tokenizer type, and data types. Version mismatches or malformed metadata structures indicate potential tampering.

- **SafeTensors** -- Parses the 8-byte little-endian header length, reads the complete JSON header, and extracts every tensor name, shape, and dtype. SafeTensors is the safest format by design (zero code execution on load -- it maps memory directly), so the scanner primarily validates structural integrity.

- **ONNX** -- Detected via a protobuf heuristic (scans the first 10 KB for the string "onnx" since ONNX has no fixed magic bytes). Extracts model metadata.

- **Unknown formats** -- Attempts to extract JSON from the first 10 KB, checks for HDF5/Keras (`\x89HDF`), NumPy (`\x80\x2b\x0a\x00` or `NUMPY`), and other known binary signatures. Reports the first 16 bytes in hex and ASCII for manual forensics.

#### Behavioral Analysis Probes (Sandbox)

These run when the model is loaded and tested in the Python sandbox (`scripts/sandbox_runner.py`). They detect issues that only manifest at runtime -- things static byte analysis cannot see.

| Probe | Severity If Failed | What It Detects | How It Works |
|---|---|---|---|
| `model-load` | HIGH | The model file cannot be loaded by any available ML library | Attempts to open the file with `safetensors.safe_open()`, `gguf.GGUFReader()`, and `onnxruntime.InferenceSession()` (whichever libraries are installed). If none can parse it, the file is either corrupted, empty, or not a real model. For ONNX models, also runs a dummy inference pass with zero-filled inputs to verify the model can actually execute. |
| `network-egress` | HIGH / CRITICAL | The model process attempts outbound network connections during load or inference | Uses `psutil.Process().connections()` to check if the Python process that loaded the model has opened any TCP/UDP sockets. A model phoning home during load is a strong indicator of malicious behavior -- it could be exfiltrating system information, receiving commands from a C2 server, or downloading additional payloads. |
| `memory-usage` | MEDIUM | Peak resident memory consumption during model loading exceeds the 2 GB warning threshold | Uses `psutil.Process().memory_info().rss` to measure the process's actual physical memory usage after model loading. Catches memory exhaustion attacks where a model is designed to consume all available RAM (denial of service), or simply flags unexpectedly large models before deployment. |
| `filesystem-write` | HIGH | The model attempts to write files outside its expected directory | Monitors the filesystem scope during model loading and inference. A model that writes unexpected files could be dropping persistence mechanisms, overwriting system files, modifying other models on disk, or planting backdoors for future execution. |

#### How Findings Flow Into Policy Gates

All vulnerability data feeds into the OPA/Rego policy evaluation when publishing to a registry. A typical policy might deny publication if:

- Any CRITICAL or HIGH severity finding exists in the SBOM
- The sandbox `network-egress` probe failed
- The model has not been scanned or signed
- The format mismatch flag is set

This creates a chain: **scan** (static) -> **sandbox** (behavioral) -> **sign** (integrity) -> **publish** (policy gate). A model must pass all stages to be allowed into a registry.

### Cryptographic Signing

ModelVault uses Ed25519 for cryptographic signing. On first use, a key pair is auto-generated and stored in `signing-keys/private.pem` (mode 0600) and `signing-keys/public.pem` (mode 0644). The signing flow takes the SHA-256 hash of the model file and produces an Ed25519 signature stored in the `Signature` table alongside the signer identity and public key. Verification re-hashes the file from disk and checks both the cryptographic signature validity and hash match for tamper detection.

### Sandbox Execution

The sandbox runs a Python 3 script (`scripts/sandbox_runner.py`) as a local subprocess with a 60-second execution timeout (90-second hard kill). It executes four security probes against the model file:

| Probe | What it tests |
|---|---|
| `model-load` | Whether the model file can be loaded without errors |
| `network-egress` | Whether the model attempts outbound network connections during load or inference |
| `memory-usage` | Peak memory consumption during model loading |
| `filesystem-write` | Whether the model attempts to write files outside its expected directory |

Results are captured as structured JSON, stored in the `SandboxJob` table, and surfaced in the UI with per-probe pass/fail status and severity ratings.

### Model Registries with Policy Gates

Registries define publication policies written in OPA/Rego. Each registry stores a `policyRego` string that is evaluated when a model is published. The default policy requires `input.model.status == "signed"`. Gate evaluation results (`ALLOWED` or `DENIED`) and associated reasons are recorded on the `RegistryArtifact` record, providing a full traceability chain from policy to publication.

### Audit Trail

Every significant action (upload, scan, sign, sandbox run, registry publish, etc.) is recorded in the `AuditLog` table with the actor identity, action type, resource reference, outcome, and structured metadata JSON. Audit logs are queryable with filters for action, resource type, outcome, and date range.

---

## Supported Model Formats

| Format | Extensions | Detection Method |
|---|---|---|
| SafeTensors | `.safetensors` | 8-byte header size + JSON header starting with `{` |
| GGUF | `.gguf` | Magic bytes `GGUF` or `GGJT` |
| ONNX | `.onnx` | ONNX protobuf header detection |
| PyTorch | `.pt`, `.pth`, `.ckpt` | ZIP container magic bytes (`PK\x03\x04`) with pickle deserialization flagging |

---

## Project Structure

```
modelvault/
├── prisma/                  # Database schema & migrations
│   └── schema.prisma        # 13-table Prisma schema (SQLite)
├── scripts/                 # Python sandbox runner
│   └── sandbox_runner.py    # Local model execution with security probes
├── signing-keys/            # Auto-generated Ed25519 key pair
│   ├── private.pem          # PKCS8 Ed25519 private key (mode 0600)
│   └── public.pem           # SPKI Ed25519 public key (mode 0644)
├── uploads/                 # Stored model files (org-scoped)
│   └── {orgId}/{modelId}/{versionId}/{filename}
├── src/
│   ├── app/
│   │   ├── api/             # API route handlers
│   │   │   ├── dashboard/   # GET /api/dashboard -- aggregated stats & activity feed
│   │   │   ├── models/
│   │   │   │   └── [id]/
│   │   │   │       ├── scan/     # POST /api/models/[id]/scan
│   │   │   │       ├── sign/     # POST /api/models/[id]/sign
│   │   │   │       ├── sandbox/  # POST & GET /api/models/[id]/sandbox
│   │   │   │       └── verify/   # GET  /api/models/[id]/verify
│   │   │   ├── registries/
│   │   │   │   ├── route.ts          # GET & POST /api/registries
│   │   │   │   └── [id]/route.ts     # GET, PUT, DELETE, POST (publish) /api/registries/[id]
│   │   │   ├── audit/            # GET /api/audit -- filtered audit log queries
│   │   │   └── org/              # Organization settings, API keys, members
│   │   ├── page.tsx           # SPA entry point / client-side router
│   │   └── globals.css        # Tailwind CSS 4 theme configuration
│   ├── components/           # React UI components
│   └── lib/                  # Core logic (server-side)
│       ├── scanner.ts        # Binary format parser, vulnerability detection, SBOM generation
│       ├── signing.ts        # Ed25519 key management, signing, and verification
│       ├── storage.ts        # File storage, SHA-256/SHA-512 hashing, Merkle tree computation
│       ├── db.ts             # Prisma client singleton
│       ├── demo-helpers.ts   # Local auth context helpers
│       └── store.ts          # Zustand client-side state management
├── package.json
└── worklog.md
```

---

## Data Flow

### Upload Flow

```
Client                        API Route                     Storage                  Database
  |                             |                             |                        |
  |-- POST /api/models -------->|                             |                        |
  |   (multipart: file +        |                             |                        |
  |    name, format, etc.)      |                             |                        |
  |                             |-- Create Model record ----->|                        |
  |                             |<-- model.id ----------------|                        |
  |                             |                             |                        |
  |                             |-- Create ModelVersion ------>|                        |
  |                             |<-- version.id --------------|                        |
  |                             |                             |                        |
  |                             |-- calculateFileHashes()     |                        |
  |                             |   (SHA-256, SHA-512,        |                        |
  |                             |    Merkle root)             |                        |
  |                             |                             |                        |
  |                             |-- saveFile() --------------->|                        |
  |                             |   (uploads/org/model/       |                        |
  |                             |    version/filename)        |                        |
  |                             |                             |                        |
  |                             |-- Update ModelVersion ----->|                        |
  |                             |   (hashes, size, path)      |                        |
  |                             |                             |                        |
  |<-- 201 { model, version } --|                             |                        |
```

### Scan Flow

```
Client                        API Route                     Scanner                  Database
  |                             |                             |                        |
  |-- POST /api/models/         |                             |                        |
  |   [id]/scan ---------------->|                             |                        |
  |                             |                             |                        |
  |                             |-- Load ModelVersion -------->|                        |
  |                             |                             |                        |
  |                             |-- readFileFromStorage() ---->|                        |
  |                             |   (disk -> Buffer)          |                        |
  |                             |                             |                        |
  |                             |-- scanModelFile() ---------->|                        |
  |                             |   detectFormat()            |                        |
  |                             |   parseSafeTensors/GGUF/    |                        |
  |                             |   ONNX/PyTorch headers      |                        |
  |                             |   generateSbom()            |                        |
  |                             |   detectVulnerabilities()   |                        |
  |                             |<-- SbomResult --------------|                        |
  |                             |                             |                        |
  |                             |-- Upsert Sbom record ------>|                        |
  |                             |-- Update version scanStatus |                        |
  |                             |-- Update model status       |                        |
  |                             |-- Create AuditLog --------->|                        |
  |                             |                             |                        |
  |<-- { sbom, vuln counts } ---|                             |                        |
```

### Sign Flow

```
Client                        API Route                  Signing                  Database
  |                             |                           |                        |
  |-- POST /api/models/         |                           |                        |
  |   [id]/sign ---------------->|                           |                        |
  |                             |                           |                        |
  |                             |-- Load ModelVersion ------>|                        |
  |                             |   (get sha256Hash)        |                        |
  |                             |                           |                        |
  |                             |-- getSigningKeys() ------>|                        |
  |                             |                           |-- Check signing-keys/  |
  |                             |                           |   private.pem exists?  |
  |                             |                           |   No -> generateKeyPair|
  |                             |                           |        + write PEM    |
  |                             |<-- { publicKey,           |                        |
  |                             |      privateKey } ---------|                        |
  |                             |                           |                        |
  |                             |-- signHash(sha256, key) ->|                        |
  |                             |   Ed25519 sign via        |                        |
  |                             |   crypto.sign()           |                        |
  |                             |<-- base64 signature ------|                        |
  |                             |                           |                        |
  |                             |-- Upsert Signature ------>|                        |
  |                             |-- Update model status ---->|                        |
  |                             |-- Create AuditLog -------->|                        |
  |                             |                           |                        |
  |<-- { signature, algorithm }-|                           |                        |
```

### Sandbox Flow

```
Client                        API Route                  Python Subprocess         Database
  |                             |                           |                        |
  |-- POST /api/models/         |                           |                        |
  |   [id]/sandbox ------------->|                           |                        |
  |                             |                           |                        |
  |                             |-- Load ModelVersion ------>|                        |
  |                             |   (get storagePath)       |                        |
  |                             |                           |                        |
  |                             |-- spawn("python3",        |                        |
  |                             |   sandbox_runner.py,      |                        |
  |                             |   filePath, timeout) ----->|                        |
  |                             |                           |-- model-load probe    |
  |                             |                           |-- network-egress probe|
  |                             |                           |-- memory-usage probe  |
  |                             |                           |-- filesystem-write    |
  |                             |                           |   probe               |
  |                             |<-- JSON result -----------|                        |
  |                             |                           |                        |
  |                             |-- Create SandboxJob ----->|                        |
  |                             |-- Create AuditLog -------->|                        |
  |                             |                           |                        |
  |<-- { job, results,         |                           |                        |
  |     findings } -------------|                           |                        |
```

### Registry Publish Flow

```
Client                        API Route                  Policy Gate              Database
  |                             |                           |                        |
  |-- POST /api/registries/     |                           |                        |
  |   [id] (publish) ----------->|                           |                        |
  |   { modelId, versionId }    |                           |                        |
  |                             |                           |                        |
  |                             |-- Load Model + Version --->|                        |
  |                             |-- Load Registry (policyRego)                        |
  |                             |                           |                        |
  |                             |-- Evaluate Rego policy --->|                        |
  |                             |   input = { model,        |                        |
  |                             |     version, sbom,        |                        |
  |                             |     signature, sandbox }  |                        |
  |                             |<-- ALLOWED / DENIED ------|                        |
  |                             |   + reasons               |                        |
  |                             |                           |                        |
  |                             |-- Create RegistryArtifact |                        |
  |                             |   (gateResult, gateReasons)                        |
  |                             |-- Update registry counts ->|                        |
  |                             |-- Create AuditLog -------->|                        |
  |                             |                           |                        |
  |<-- { artifact, gateResult }-|                           |                        |
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js
- Python 3 (for sandbox execution; optional -- sandbox probes return graceful fallbacks if Python is not installed)

### Setup

```bash
# Install dependencies
bun install

# Push the Prisma schema to SQLite
bun run db:push

# Generate the Prisma client
bun run db:generate

# Seed the database with a demo organization and user
bun prisma db seed

# Start the development server
bun run dev
```

The application will be available at `http://localhost:3000`.

### Environment

ModelVault uses a single environment variable for the database connection:

```
DATABASE_URL=file:./db/custom.db
```

This is set in `.env` (not checked in). The SQLite database file is created automatically by Prisma.

---

## Technology Stack

| Component | Technology |
|---|---|
| Runtime | Next.js 16, React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4, shadcn/ui, tw-animate-css |
| State Management | Zustand 5 |
| Data Fetching | TanStack React Query 5 |
| Database | SQLite via Prisma ORM 6 |
| Forms | React Hook Form 7, Zod 4 |
| Cryptography | Ed25519 (Node.js built-in `crypto`) |
| Sandbox Runtime | Python 3 (subprocess) |
| Package Manager | Bun |

---

## Database Schema

The Prisma schema defines 13 models:

- **Organization** -- Tenant container with membership
- **User** -- Local user accounts with MFA support
- **OrgMember** -- Role-based organization membership (owner, admin, viewer)
- **Model** -- Top-level model record with format, status, and version tracking
- **ModelVersion** -- Immutable version snapshots with file hashes and storage paths
- **Signature** -- Ed25519 cryptographic signatures linked to model versions
- **Sbom** -- CycloneDX ML-BOM content with vulnerability severity counts
- **SandboxJob** -- Sandbox execution records with probe results and timing
- **Registry** -- Policy-gated model registries storing OPA/Rego rules
- **RegistryArtifact** -- Published models with gate evaluation results
- **ApiKey** -- API key records with hashed keys and permissions
- **AuditLog** -- Immutable action log with actor, action, resource, and outcome

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/dashboard` | Aggregated dashboard stats, activity feed, vulnerability distribution |
| GET | `/api/models` | List models with cursor-based pagination and filters |
| POST | `/api/models` | Upload a new model (multipart or JSON) |
| POST | `/api/models/[id]/scan` | Run binary format scan and generate SBOM |
| POST | `/api/models/[id]/sign` | Sign model version with Ed25519 |
| GET | `/api/models/[id]/verify` | Verify signature and detect tampering |
| POST | `/api/models/[id]/sandbox` | Execute sandbox probes against model file |
| GET | `/api/models/[id]/sandbox` | List sandbox job history for a model |
| GET | `/api/registries` | List all registries with artifacts |
| POST | `/api/registries` | Create a new registry with Rego policy |
| GET | `/api/registries/[id]` | Get registry details and artifacts |
| POST | `/api/registries/[id]` | Publish a model to the registry (evaluates policy gate) |
| GET | `/api/audit` | Query audit logs with filters |
| GET | `/api/org` | Get organization settings |
| GET/POST | `/api/org/members` | Manage organization members |
| GET/POST | `/api/org/api-keys` | Manage API keys |

---

## License

Private -- all rights reserved.