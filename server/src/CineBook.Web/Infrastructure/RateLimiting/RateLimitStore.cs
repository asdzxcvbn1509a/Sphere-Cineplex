using System.Collections.Concurrent;

namespace CineBook.Web.Infrastructure.RateLimiting;

public sealed record RateLimitHit(int TotalHits, DateTimeOffset ResetTime);

/// <summary>
/// ตัวนับแบบ fixed window ในหน่วยความจำ — กติกาเดียวกับ MemoryStore ของ express-rate-limit
/// แต่ละกุญแจมีหน้าต่างของตัวเองที่เริ่มนับจากครั้งแรกที่เจอ และเริ่มใหม่เมื่อหมดหน้าต่าง
///
/// เก็บในหน่วยความจำของ instance เดียว (App Service แพ็กเกจ F1 มี instance เดียว) — restart แล้วนับใหม่หมด
/// เหมือนของเดิม ซึ่งยอมรับได้เพราะเป็นด่านกันสคริปต์ยิงรัว ไม่ใช่โควตาที่ต้องแม่นยำข้ามการ restart
/// </summary>
public sealed class RateLimitStore(TimeProvider time)
{
    private sealed class Counter
    {
        public int TotalHits;
        public DateTimeOffset ResetTime;
    }

    private readonly ConcurrentDictionary<string, Counter> _counters = new();
    private long _lastSweep;

    public RateLimitHit Increment(string key, TimeSpan window)
    {
        var now = time.GetUtcNow();
        Sweep(now);
        var counter = _counters.GetOrAdd(key, _ => new Counter { ResetTime = now + window });
        lock (counter)
        {
            if (counter.ResetTime <= now)
            {
                counter.TotalHits = 0;
                counter.ResetTime = now + window;
            }
            counter.TotalHits += 1;
            return new RateLimitHit(counter.TotalHits, counter.ResetTime);
        }
    }

    /// <summary>คืนหนึ่งครั้ง (คำขอที่ไม่ต้องนับ เช่น ล็อกอินสำเร็จ) — หน้าต่างหมดไปแล้วก็ไม่ต้องคืน</summary>
    public void Decrement(string key, DateTimeOffset resetTime)
    {
        if (time.GetUtcNow() >= resetTime) return;
        if (!_counters.TryGetValue(key, out var counter)) return;
        lock (counter)
        {
            if (counter.TotalHits > 0) counter.TotalHits -= 1;
        }
    }

    /// <summary>ล้างกุญแจที่หมดหน้าต่างแล้วทุก ๆ นาที ไม่ให้หน่วยความจำโตไปเรื่อย ๆ</summary>
    private void Sweep(DateTimeOffset now)
    {
        var last = Interlocked.Read(ref _lastSweep);
        if (now.ToUnixTimeMilliseconds() - last < 60_000) return;
        if (Interlocked.CompareExchange(ref _lastSweep, now.ToUnixTimeMilliseconds(), last) != last) return;
        foreach (var (key, counter) in _counters)
        {
            if (counter.ResetTime <= now) _counters.TryRemove(key, out _);
        }
    }

    /// <summary>เทสต์ใช้ล้างตัวนับระหว่างเคส</summary>
    public void Reset() => _counters.Clear();
}
