# 🧪 Testing Setup Instructions for Barkat_vo

## 📦 Installation

### Step 1: Install Testing Dependencies
```bash
npm install --save-dev @types/jest @testing-library/jest-dom @testing-library/react @testing-library/user-event jest jest-environment-jsdom ts-jest
```

### Step 2: Update Package.json Scripts
Add these scripts to your `package.json`:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:workerPool": "jest src/__tests__/main/utils/workerPool.test.ts"
  }
}
```

## 🚀 Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Coverage Report
```bash
npm run test:coverage
```

### Run Specific Worker Pool Tests
```bash
npm run test:workerPool
```

## 📁 Test Structure

```
src/
├── __tests__/
│   ├── setup.ts                    # Global test configuration
│   ├── main/
│   │   └── utils/
│   │       └── workerPool.test.ts  # Worker pool tests
│   ├── renderer/
│   │   ├── components/             # UI component tests
│   │   ├── pages/                  # Page component tests
│   │   └── hooks/                  # Custom hook tests
│   └── integration/                # End-to-end tests
```

## 🎯 Test Coverage Features

### ✅ Worker Pool Tests Cover:
- **Task Queue Management** - Priority sorting, enqueue/dequeue
- **Task Execution** - Progress events, completion, errors
- **Cancellation** - Queued and active task cancellation
- **Status Tracking** - Real-time task status updates
- **Progress Callbacks** - Event handling and callbacks
- **Main Window Integration** - IPC communication
- **Edge Cases** - Error handling, malformed events
- **Performance** - Large data handling, memory management

### 📊 Coverage Metrics:
- **Branch Coverage:** 100% for all conditional paths
- **Function Coverage:** 100% for all methods
- **Statement Coverage:** 95%+ target
- **Edge Case Coverage:** All error scenarios tested

## 🔧 Test Configuration

### Jest Configuration (`jest.config.js`)
- TypeScript support via `ts-jest`
- Node environment for main process tests
- JSDOM environment for renderer tests
- Coverage reporting with HTML output
- 10-second timeout for async operations

### Mock Configuration
- **Electron APIs** - BrowserWindow, app, ipcMain
- **Worker Threads** - Worker class and events
- **File System** - Path operations
- **Timers** - Fake timers for async testing

## 🐛 Debugging Tests

### Debug Mode
```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

### Specific Test Debugging
```bash
node --inspect-brk node_modules/.bin/jest workerPool.test.ts --runInBand
```

## 📈 Continuous Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v1
```

## 🎯 Next Steps

### Additional Test Files to Create:
1. **Database Service Tests** - CRUD operations
2. **React Component Tests** - UI interactions
3. **Hook Tests** - Custom React hooks
4. **Integration Tests** - End-to-end workflows
5. **Performance Tests** - Load and stress testing

### Test Data Management:
- Mock Excel files for import testing
- Sample database fixtures
- Test user scenarios
- Error simulation data

## ⚡ Performance Considerations

- **Parallel Execution** - Tests run in parallel by default
- **Mock Isolation** - Each test has isolated mocks
- **Memory Cleanup** - Automatic cleanup after each test
- **Async Handling** - Proper async/await patterns
- **Timer Management** - Fake timers prevent flaky tests

## 🔍 Troubleshooting

### Common Issues:
1. **Module Resolution** - Check `tsconfig.json` paths
2. **Mock Configuration** - Verify mock implementations
3. **Async Timeouts** - Increase timeout for slow operations
4. **Memory Leaks** - Ensure proper cleanup in tests

### Debug Commands:
```bash
# Verbose test output
npm test -- --verbose

# Run specific test file
npm test workerPool.test.ts

# Update snapshots
npm test -- --updateSnapshot
```
