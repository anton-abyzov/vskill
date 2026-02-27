---
description: Dart 3+ language features, Riverpod 2.0 code generation, and GoRouter declarative routing for Flutter. Use for sealed classes, records, pattern matching, Riverpod codegen providers, or GoRouter setup.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
model: opus
context: fork
---

# Flutter -- Dart 3+, Riverpod 2.0, GoRouter

## Dart 3 Language Features

### Records and Pattern Matching

```dart
// Records -- lightweight data structures
(String name, int age) getUserInfo() => ('Alice', 30);
final (name, age) = getUserInfo();

// Named records
({String city, String country}) getLocation() =>
    (city: 'Berlin', country: 'Germany');

// Switch expressions with patterns
String describeValue(Object value) => switch (value) {
  int n when n < 0 => 'negative',
  int n when n == 0 => 'zero',
  int() => 'positive integer',
  String s when s.isEmpty => 'empty string',
  String() => 'non-empty string',
  List(isEmpty: true) => 'empty list',
  List(length: final len) => 'list of $len items',
  _ => 'unknown',
};

// If-case with patterns
void processResponse(Map<String, dynamic> json) {
  if (json case {'status': 'ok', 'data': final List items}) {
    for (final item in items) {
      processItem(item);
    }
  }
}
```

### Sealed Classes and Class Modifiers

```dart
// Sealed classes for exhaustive pattern matching
sealed class AuthState {}
class AuthInitial extends AuthState {}
class AuthLoading extends AuthState {}
class AuthAuthenticated extends AuthState {
  final User user;
  AuthAuthenticated(this.user);
}
class AuthError extends AuthState {
  final String message;
  AuthError(this.message);
}

// Exhaustive switch (compiler enforces all cases)
Widget buildAuthUI(AuthState state) => switch (state) {
  AuthInitial() => const LoginScreen(),
  AuthLoading() => const LoadingScreen(),
  AuthAuthenticated(:final user) => HomeScreen(user: user),
  AuthError(:final message) => ErrorScreen(message: message),
};

// Class modifiers
final class DatabaseConfig {          // Cannot be extended or implemented
  final String host;
  final int port;
  const DatabaseConfig({required this.host, required this.port});
}

interface class Logger {              // Can only be implemented, not extended
  void log(String message);
}

base class Repository {               // Can be extended but not implemented
  void save(Object entity) { /* ... */ }
}

mixin class Trackable {               // Can be used as both mixin and class
  void track(String event) { /* ... */ }
}
```

## Riverpod 2.0 Code Generation

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'providers.g.dart';

// Simple provider (auto-disposed by default with codegen)
@riverpod
String appVersion(Ref ref) => '1.0.0';

// FutureProvider for async data
@riverpod
Future<List<Product>> products(Ref ref) async {
  final repository = ref.watch(productRepositoryProvider);
  return repository.getAll();
}

// Notifier for mutable state
@riverpod
class CartNotifier extends _$CartNotifier {
  @override
  List<CartItem> build() => [];

  void addItem(Product product) {
    state = [...state, CartItem(product: product, quantity: 1)];
  }

  void removeItem(String productId) {
    state = state.where((item) => item.product.id != productId).toList();
  }

  double get totalPrice =>
      state.fold(0, (sum, item) => sum + item.product.price * item.quantity);
}

// Family provider (parameterized)
@riverpod
Future<Product> productDetail(Ref ref, String id) async {
  final repository = ref.watch(productRepositoryProvider);
  return repository.getById(id);
}

// Consuming in widgets
class ProductListScreen extends ConsumerWidget {
  const ProductListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final productsAsync = ref.watch(productsProvider);

    return productsAsync.when(
      data: (products) => ListView.builder(
        itemCount: products.length,
        itemBuilder: (context, index) => ProductTile(product: products[index]),
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('Error: $error')),
    );
  }
}
```

## GoRouter Declarative Routing

```dart
import 'package:go_router/go_router.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authNotifierProvider);

  return GoRouter(
    initialLocation: '/',
    debugLogDiagnostics: true,
    redirect: (context, state) {
      final isLoggedIn = authState is AuthAuthenticated;
      final isLoginRoute = state.matchedLocation == '/login';

      if (!isLoggedIn && !isLoginRoute) return '/login';
      if (isLoggedIn && isLoginRoute) return '/';
      return null;
    },
    routes: [
      ShellRoute(
        builder: (context, state, child) => AppScaffold(child: child),
        routes: [
          GoRoute(
            path: '/',
            name: 'home',
            builder: (context, state) => const HomeScreen(),
          ),
          GoRoute(
            path: '/products/:id',
            name: 'product-detail',
            builder: (context, state) {
              final id = state.pathParameters['id']!;
              return ProductDetailScreen(productId: id);
            },
          ),
          GoRoute(
            path: '/profile',
            name: 'profile',
            builder: (context, state) => const ProfileScreen(),
            routes: [
              GoRoute(
                path: 'settings',
                name: 'settings',
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
    ],
  );
});

// Navigation usage
context.go('/products/abc123');
context.goNamed('product-detail', pathParameters: {'id': 'abc123'});
context.push('/products/abc123');  // Push onto stack (preserves back navigation)
```

## Freezed Data Classes

```dart
import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:json_annotation/json_annotation.dart';

part 'user.freezed.dart';
part 'user.g.dart';

@freezed
class User with _$User {
  const factory User({
    required String id,
    required String name,
    required String email,
    String? avatarUrl,
    @Default(false) bool isVerified,
    @Default([]) List<String> roles,
  }) = _User;

  factory User.fromJson(Map<String, dynamic> json) => _$UserFromJson(json);
}
```
