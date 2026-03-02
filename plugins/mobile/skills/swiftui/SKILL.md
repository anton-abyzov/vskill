---
description: SwiftUI and Swift 6 expert for iOS native development. Covers view composition, NavigationStack, @Observable, SwiftData, structured concurrency, MVVM/TCA architecture, Xcode configuration, preview-driven development, accessibility, and testing. Use for iOS/macOS/watchOS/tvOS SwiftUI projects.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# SwiftUI Expert - iOS Native Development with Swift 6

Comprehensive SwiftUI expertise for building modern Apple platform applications. This skill covers the latest APIs and patterns for iOS 17+, macOS 14+, watchOS 10+, and tvOS 17+.

## Project Setup

### Creating a New SwiftUI Project

```bash
# Xcode project structure (New Project > App)
MyApp/
├── MyApp.xcodeproj/
├── MyApp/
│   ├── MyAppApp.swift    # @main entry point
│   ├── Models/ Views/ ViewModels/ Services/
│   └── Assets.xcassets/ Info.plist
├── MyAppTests/
├── MyAppUITests/
└── Package.swift         # SPM dependencies
```

### Swift Package Manager Dependencies

```swift
// Package.swift — swift-tools-version: 6.0
let package = Package(
    name: "MyApp",
    platforms: [.iOS(.v17), .macOS(.v14)],
    dependencies: [
        .package(url: "https://github.com/pointfreeco/swift-composable-architecture", from: "1.15.0"),
        .package(url: "https://github.com/pointfreeco/swift-dependencies", from: "1.4.0"),
    ],
    targets: [
        .target(name: "MyApp", dependencies: [
            .product(name: "ComposableArchitecture", package: "swift-composable-architecture"),
        ]),
        .testTarget(name: "MyAppTests", dependencies: ["MyApp"]),
    ]
)
```

## Navigation

### NavigationStack (iOS 16+, preferred)

```swift
// NEVER use NavigationView - it is deprecated
struct AppNavigation: View {
    @State private var path = NavigationPath()

    var body: some View {
        NavigationStack(path: $path) {
            HomeView()
                .navigationDestination(for: Product.self) { ProductDetailView(product: $0) }
                .navigationDestination(for: User.self) { ProfileView(user: $0) }
        }
        .environment(\.navigationPath, $path)
    }
}
// Programmatic push: @Environment(\.navigationPath) var path → path.wrappedValue.append(item)
```

## State Management

### @Observable (Observation Framework - iOS 17+, preferred)

```swift
// PREFER @Observable over ObservableObject for new code (iOS 17+)
import Observation

@Observable
class UserSession {
    var currentUser: User?
    var isAuthenticated: Bool { currentUser != nil }
    var authToken: String?

    func signIn(email: String, password: String) async throws {
        let r = try await AuthService.signIn(email: email, password: password)
        currentUser = r.user; authToken = r.token
    }
    func signOut() { currentUser = nil; authToken = nil }
}

// Usage in views - no @ObservedObject/@StateObject needed
struct ProfileView: View {
    var session: UserSession  // Direct reference, auto-tracks changes
    var body: some View {
        if let user = session.currentUser { Text(user.displayName) }
    }
}

// Inject via @State at root: @State private var session = UserSession()
// Pass down directly — no EnvironmentObject wrapper needed
```

### @Environment for Dependency Injection

```swift
// Define environment key
struct NetworkServiceKey: EnvironmentKey {
    static let defaultValue: NetworkService = LiveNetworkService()
}
extension EnvironmentValues {
    var networkService: NetworkService {
        get { self[NetworkServiceKey.self] }
        set { self[NetworkServiceKey.self] = newValue }
    }
}

// Inject: ContentView().environment(\.networkService, MockNetworkService())
// Consume: @Environment(\.networkService) private var network
```

## SwiftData Persistence (iOS 17+)

### Model Definition

```swift
import SwiftData

@Model
class Task {
    var title: String
    var isCompleted: Bool
    var createdAt: Date
    var dueDate: Date?
    @Relationship(deleteRule: .cascade) var subtasks: [Subtask]
    @Relationship(inverse: \Project.tasks) var project: Project?

    init(title: String, isCompleted: Bool = false) {
        self.title = title
        self.isCompleted = isCompleted
        self.createdAt = .now
    }
}

@Model
class Project {
    var name: String
    @Relationship(deleteRule: .cascade) var tasks: [Task]
    init(name: String) { self.name = name; self.tasks = [] }
}
```

### Container Setup and Queries

```swift
// App entry: .modelContainer(for: [Task.self, Project.self]) on WindowGroup

struct TaskListView: View {
    @Query(sort: \Task.createdAt, order: .reverse) var tasks: [Task]
    @Query(filter: #Predicate<Task> { !$0.isCompleted }) var pendingTasks: [Task]
    @Environment(\.modelContext) private var context

    var body: some View {
        List { ForEach(tasks) { TaskRow(task: $0) }
            .onDelete { indexSet in indexSet.forEach { context.delete(tasks[$0]) } }
        }
        .toolbar { Button("Add") { context.insert(Task(title: "New Task")) } }
    }
}
```

### When to Use Core Data Instead

| Criteria | SwiftData | Core Data |
|----------|-----------|-----------|
| iOS 17+ only | Preferred | Fallback |
| CloudKit sync | Supported | More mature |
| Complex migrations | Limited | Full control |
| NSFetchedResultsController | Not available | Available |
| Background processing | modelActor | performBackgroundTask |
| Existing Core Data app | Gradual migration | Keep |

## Swift 6 Structured Concurrency

### async/await Patterns

```swift
@Observable
class ProductViewModel {
    var products: [Product] = []
    var isLoading = false
    var error: Error?

    func loadProducts() async {
        isLoading = true; defer { isLoading = false }
        do { products = try await ProductService.fetchAll() }
        catch { self.error = error }
    }
}
// View: .task { await viewModel.loadProducts() } — auto-cancels on disappear
```

### Actors and Sendable

```swift
// Actor for thread-safe mutable state
actor ImageCache {
    private var cache: [URL: Image] = [:]
    func image(for url: URL) -> Image? { cache[url] }
    func store(_ image: Image, for url: URL) { cache[url] = image }
}

// @MainActor for UI-bound types
@MainActor @Observable
class NavigationRouter {
    var path = NavigationPath()
    func navigate(to destination: any Hashable) { path.append(destination) }
    func popToRoot() { path = NavigationPath() }
}
```

### TaskGroup for Parallel Work

```swift
func loadDashboard() async throws -> Dashboard {
    async let profile = fetchProfile()
    async let feed = fetchFeed()
    async let notifications = fetchNotifications()

    return try await Dashboard(
        profile: profile,
        feed: feed,
        notifications: notifications
    )
}
```

## Architecture Decision Framework

### MVVM (Default Choice)

```
When to choose MVVM:
- Small to medium apps
- Team familiar with UIKit MVVM
- Straightforward data flow
- Quick prototyping needed
```

```swift
@Observable
class SettingsViewModel {
    var notificationsEnabled = true
    var theme: AppTheme = .system
    private let settingsService: SettingsService

    init(settingsService: SettingsService) {
        self.settingsService = settingsService
    }

    func save() async throws {
        try await settingsService.update(notifications: notificationsEnabled, theme: theme)
    }
}

// In the View: @State private var viewModel: SettingsViewModel
// Init via: _viewModel = State(initialValue: SettingsViewModel(settingsService: settingsService))
```

### TCA (The Composable Architecture)

```
When to choose TCA:
- Large apps with complex state
- Need strict unidirectional data flow
- Heavy testing requirements
- Team comfortable with functional patterns
- Feature modularity is critical
```

```swift
import ComposableArchitecture

@Reducer
struct CounterFeature {
    @ObservableState
    struct State: Equatable {
        var count = 0
        var isTimerRunning = false
    }

    enum Action {
        case incrementTapped
        case decrementTapped
        case toggleTimerTapped
        case timerTick
    }

    enum CancelID { case timer }

    var body: some ReducerOf<Self> {
        Reduce { state, action in
            switch action {
            case .incrementTapped:
                state.count += 1
                return .none
            case .decrementTapped:
                state.count -= 1
                return .none
            case .toggleTimerTapped:
                state.isTimerRunning.toggle()
                if state.isTimerRunning {
                    return .run { send in
                        while true {
                            try await Task.sleep(for: .seconds(1))
                            await send(.timerTick)
                        }
                    }
                    .cancellable(id: CancelID.timer)
                } else {
                    return .cancel(id: CancelID.timer)
                }
            case .timerTick:
                state.count += 1
                return .none
            }
        }
    }
}

// View reads store.count, store.isTimerRunning directly; sends via store.send(.action)
struct CounterView: View {
    let store: StoreOf<CounterFeature>
    var body: some View {
        VStack {
            Text("\(store.count)").font(.largeTitle)
            Button(store.isTimerRunning ? "Stop" : "Start") { store.send(.toggleTimerTapped) }
        }
    }
}
```

## Preview-Driven Development

```swift
// Always provide previews with representative data — multiple variants
#Preview("Default") { ProfileView(user: .preview) }
#Preview("Long Bio") { ProfileView(user: .previewLongBio) }

extension User {
    static var preview: User {
        User(displayName: "Jane Doe", bio: "iOS Developer", postCount: 42)
    }
}

// Preview with SwiftData — use inMemory container
#Preview {
    NavigationStack { TaskListView() }
        .modelContainer(for: Task.self, inMemory: true)
}
```

## Accessibility

### VoiceOver and Dynamic Type

```swift
struct ProductCard: View {
    let product: Product

    var body: some View {
        VStack {
            AsyncImage(url: product.imageURL).accessibilityHidden(true) // Decorative
            Text(product.name).font(.headline)
            Text(product.price, format: .currency(code: "USD")).font(.subheadline)
            Button("Add to Cart") { addToCart(product) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(product.name), \(product.price.formatted(.currency(code: "USD")))")
        .accessibilityHint("Double tap to add to cart")
        .accessibilityAddTraits(.isButton)
    }
}

// Dynamic Type support
struct AdaptiveStack<Content: View>: View {
    @Environment(\.dynamicTypeSize) var typeSize
    @ViewBuilder let content: () -> Content

    var body: some View {
        if typeSize >= .accessibility1 {
            VStack(alignment: .leading, content: content)
        } else {
            HStack(content: content)
        }
    }
}
```

## Testing

### TCA Reducer Tests

```swift
import ComposableArchitecture
import XCTest

final class CounterFeatureTests: XCTestCase {
    @MainActor
    func testTimer() async {
        let clock = TestClock()
        let store = TestStore(initialState: CounterFeature.State()) {
            CounterFeature()
        } withDependencies: {
            $0.continuousClock = clock
        }

        await store.send(.toggleTimerTapped) {
            $0.isTimerRunning = true
        }
        await clock.advance(by: .seconds(1))
        await store.receive(.timerTick) {
            $0.count = 1
        }
        await store.send(.toggleTimerTapped) {
            $0.isTimerRunning = false
        }
    }
}
```

### XCUITest for UI Testing

```swift
import XCUITest

final class OnboardingUITests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() { continueAfterFailure = false; app.launchArguments = ["--ui-testing"]; app.launch() }

    func testOnboardingFlow() {
        XCTAssertTrue(app.staticTexts["Welcome"].exists)

        app.buttons["Get Started"].tap()
        XCTAssertTrue(app.staticTexts["Choose Your Interests"].exists)

        app.buttons["Technology"].tap()
        app.buttons["Continue"].tap()

        XCTAssertTrue(app.staticTexts["Home"].waitForExistence(timeout: 5))
    }
}
```

## App Lifecycle and Deep Linking

```swift
@main
struct MyApp: App {
    @State private var session = UserSession()

    var body: some Scene {
        WindowGroup {
            ContentView(session: session)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
        .modelContainer(for: [Task.self])
    }

    private func handleDeepLink(_ url: URL) {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return }
        switch components.host {
        case "product":
            if let id = components.queryItems?.first(where: { $0.name == "id" })?.value {
                session.navigate(to: .product(id: id))
            }
        case "profile": session.navigate(to: .profile)
        default: break
        }
    }
}
```

## Xcode Configuration Best Practices

### Build Schemes

```
- MyApp (Debug): Development server, verbose logging, mock data available
- MyApp (Staging): Staging API, analytics disabled
- MyApp (Release): Production API, optimizations on, analytics enabled
```

### Info.plist / Entitlements Checklist

| Capability | Entitlement | Info.plist Key |
|-----------|-------------|----------------|
| Push notifications | aps-environment | - |
| HealthKit | healthkit | NSHealthShareUsageDescription |
| Camera | - | NSCameraUsageDescription |
| Location | - | NSLocationWhenInUseUsageDescription |
| Background tasks | background-modes | UIBackgroundModes |
| App Groups | app-groups | - |
| Keychain sharing | keychain-access-groups | - |

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| Using NavigationView | Replace with NavigationStack (NavigationView is deprecated) |
| Using ObservableObject in new code | Use @Observable (Observation framework) for iOS 17+ |
| Forgetting .task cancellation | .task auto-cancels when view disappears; use for async work |
| State in preview crashes | Use in-memory model containers and preview-specific data |
| @Published + @Observable | Never combine; @Observable does not use @Published |
| Large body property | Extract subviews, use computed properties, apply modifiers in extensions |
| Implicit animations on data change | Use .animation(.default, value: specificValue) not .animation(.default) |

## Related Skills

- `appstore` - **Recommended**: App Store Connect automation via `asc` CLI (TestFlight, submissions, metadata, signing, Xcode Cloud)
- `mobile-testing` - Comprehensive testing strategies (XCTest, XCUITest)
- `deep-linking-push` - Deep linking (Universal Links) and push notifications (APNs)
