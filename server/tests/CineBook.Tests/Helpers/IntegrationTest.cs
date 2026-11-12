using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using CineBook.Web.Data;
using CineBook.Web.Infrastructure.Auth;
using CineBook.Web.Infrastructure.Json;
using CineBook.Web.Models.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace CineBook.Tests.Helpers;

[CollectionDefinition(Name)]
public sealed class IntegrationCollection : ICollectionFixture<ApiFactory>
{
    public const string Name = "Integration";
}

/// <summary>
/// ฐานของ integration test — ทุกคลาสใช้แอปตัวเดียวกัน (collection เดียว จึงรันทีละคลาส)
/// ก่อนแต่ละเคส: ล้างทุกตาราง และล้างตัวนับ rate limit (ของเดิมเป็นตัวนับในหน่วยความจำของแอปแต่ละตัว)
/// เคสที่ต้องการให้ยิงพร้อมกันจริงใช้ Task.WhenAll โดยแต่ละงานเปิด scope (DbContext) ของตัวเอง
/// </summary>
[Collection(IntegrationCollection.Name)]
public abstract class IntegrationTest(ApiFactory factory) : IAsyncLifetime
{
    protected ApiFactory Factory { get; } = factory;

    protected Fixtures Fx { get; private set; } = null!;

    private readonly List<IServiceScope> _scopes = [];

    public virtual async Task InitializeAsync()
    {
        await TestDatabase.ResetAsync(Factory);
        Factory.ResetRateLimits();
        Fx = new Fixtures(Factory);
    }

    public virtual Task DisposeAsync()
    {
        foreach (var scope in _scopes) scope.Dispose();
        return Task.CompletedTask;
    }

    /// <summary>scope ใหม่ (DbContext ใหม่) — ใช้ต่องานที่ยิงพร้อมกัน</summary>
    protected IServiceScope NewScope()
    {
        var scope = Factory.Services.CreateScope();
        _scopes.Add(scope);
        return scope;
    }

    protected T Get<T>() where T : notnull => NewScope().ServiceProvider.GetRequiredService<T>();

    protected AppDbContext Db() => Get<AppDbContext>();

    protected HttpClient Client(string? token = null)
    {
        var client = Factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
            HandleCookies = false,
        });
        if (token is not null) client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    protected string TokenFor(User user) => Factory.Services.GetRequiredService<AccessTokens>().Sign(user);

    protected static async Task<JsonObject> Json(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<JsonObject>(JsonDefaults.Api))!;

    protected static async Task<string?> ErrorCode(HttpResponseMessage response) =>
        (await Json(response))["error"]?["code"]?.GetValue<string>();

    protected static StringContent JsonBody(object body) =>
        new(JsonSerializer.Serialize(body, JsonDefaults.Api), System.Text.Encoding.UTF8, "application/json");
}
