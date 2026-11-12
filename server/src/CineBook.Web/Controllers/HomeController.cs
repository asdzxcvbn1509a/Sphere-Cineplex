using CineBook.Web.Infrastructure.Config;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CineBook.Web.Controllers;

/// <summary>
/// หน้าเว็บ React (View ของระบบ) — ทุก path ที่ไม่ใช่ /api และไม่ใช่ไฟล์ใน wwwroot มาจบที่นี่
/// คืน index.html ที่ Vite build ไว้ แล้ว React Router ในเบราว์เซอร์เลือกหน้าเอง (deep link และรีเฟรชหน้าจึงไม่ 404)
/// </summary>
[AllowAnonymous]
public sealed class HomeController(IWebHostEnvironment environment, AppConfig config) : Controller
{
    public IActionResult Index()
    {
        var index = environment.WebRootFileProvider.GetFileInfo("index.html");
        if (index.Exists && index.PhysicalPath is not null)
        {
            return PhysicalFile(index.PhysicalPath, "text/html; charset=utf-8");
        }

        // ตอนพัฒนาไม่มีไฟล์ build — หน้าเว็บรันจาก Vite (:5173) ที่ proxy /api มาที่นี่
        return config.IsDevelopment ? View("DevNotice") : NotFound();
    }
}
