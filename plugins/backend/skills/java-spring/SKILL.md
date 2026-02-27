---
description: Java 21 Virtual Threads in Spring Boot 3.x and Spring Security 6 lambda DSL configuration.
allowed-tools: Read, Write, Edit, Bash
model: opus
---

# Java Spring Boot

## Java 21 Virtual Threads in Spring Boot 3.x

**One-line enablement** (`application.yml`):
```yaml
spring:
  threads:
    virtual:
      enabled: true   # Spring Boot 3.2+
```

This switches Tomcat's thread pool to virtual threads. Implications:
- Every request handler runs on a virtual thread -- blocking I/O (JDBC, HTTP clients, file I/O) no longer wastes platform threads
- `synchronized` blocks pin virtual threads to carrier threads. Replace with `ReentrantLock`:
```java
// BAD: pins virtual thread
private synchronized void criticalSection() { /* ... */ }

// GOOD: does not pin
private final ReentrantLock lock = new ReentrantLock();
private void criticalSection() {
    lock.lock();
    try { /* ... */ } finally { lock.unlock(); }
}
```
- Connection pool sizing: with virtual threads you can have many more concurrent requests than platform threads. Ensure `spring.datasource.hikari.maximum-pool-size` is tuned -- the pool becomes the bottleneck, not thread count
- `@Async` tasks also run on virtual threads when enabled
- **Do NOT combine with WebFlux** -- virtual threads solve the same problem (non-blocking I/O) for imperative code. Choose one approach
- Programmatic config (alternative to YAML):
```java
@Bean
public TomcatProtocolHandlerCustomizer<?> virtualThreadCustomizer() {
    return protocolHandler ->
        protocolHandler.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
}
```

## Spring Security 6 Lambda DSL

Spring Security 6 removed the old chained builder API. The new lambda DSL:

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/public/**").permitAll()
                .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthFilter,
                UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOrigins(List.of("http://localhost:3000"));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}
```

Key changes from Spring Security 5:
- `.csrf()` -> `.csrf(AbstractHttpConfigurer::disable)` (lambda, not chained)
- `.authorizeRequests()` -> `.authorizeHttpRequests(auth -> ...)`
- `.antMatchers()` -> `.requestMatchers()`
- `.access("hasRole('ADMIN')")` -> `.hasRole("ADMIN")` (type-safe)
- `WebSecurityConfigurerAdapter` is removed -- use `@Bean SecurityFilterChain` instead
- `@EnableGlobalMethodSecurity` -> `@EnableMethodSecurity` (enables `@PreAuthorize` by default)
