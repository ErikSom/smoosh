fn safeNormal(n: vec2f) -> vec2f {
    return n / max(length(n), 0.00001);
}

// g_domain stores the distance to the UNION boundary, so area seams stay open.
fn sampleDomain(p: vec2f) -> vec4f {
    let q = clamp(p, vec2f(0), vec2f(g_simConstants.gridSize) - 1.001);
    let lo = vec2u(q);
    let hi = min(lo + 1u, g_simConstants.gridSize - 1u);
    let t = fract(q);
    let a = mix(g_domain[lo.y * g_simConstants.gridSize.x + lo.x], g_domain[lo.y * g_simConstants.gridSize.x + hi.x], t.x);
    let b = mix(g_domain[hi.y * g_simConstants.gridSize.x + lo.x], g_domain[hi.y * g_simConstants.gridSize.x + hi.x], t.x);
    return mix(a, b, t.y);
}
