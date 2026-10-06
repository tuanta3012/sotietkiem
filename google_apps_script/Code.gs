/**
 * ============================================================================
 * GOOGLE APPS SCRIPT: WEBHOOK GỬI EMAIL MỜI THAM GIA KHÔNG GIAN LÀM VIỆC
 * Ứng dụng: Sổ Tiết Kiệm Gia Đình (Serverless Invite Mailer)
 * ============================================================================
 * 
 * Hướng dẫn triển khai Web App:
 * 1. Mở https://script.google.com/ và tạo dự án mới "SoTietKiem_InviteMailer".
 * 2. Dán toàn bộ mã nguồn này vào file Code.gs.
 * 3. Bấm "Triển khai" (Deploy) > "Tùy chọn triển khai mới" (New deployment).
 * 4. Chọn loại: "Ứng dụng web" (Web App).
 *    - Mô tả: "Mailer Webhook v1.0"
 *    - Thực thi dưới dạng: "Tôi" (Execute as: Me - Tài khoản Gmail của bạn)
 *    - Ai có quyền truy cập: "Bất kỳ ai" (Who has access: Anyone)
 * 5. Bấm "Triển khai" (Deploy) và cấp quyền truy cập Gmail khi được hỏi.
 * 6. Sao chép "URL ứng dụng web" (Web App URL) và dán vào phần Cài đặt của Ứng dụng.
 */

/**
 * Xử lý yêu cầu HTTP POST gửi từ Ứng dụng
 */
function doPost(e) {
  try {
    var rawData = e.postData ? e.postData.contents : null;
    if (!rawData) {
      return createJsonResponse({ status: "error", message: "Không nhận được dữ liệu POST" }, 400);
    }

    var data = JSON.parse(rawData);
    var userEmail = data.userEmail ? data.userEmail.trim() : null;
    var fileId = data.fileId ? data.fileId.trim() : null;
    var workspaceName = data.workspaceName ? data.workspaceName.trim() : "Sổ Tiết Kiệm Gia Đình";
    var adminName = data.adminName ? data.adminName.trim() : "Quản trị viên";
    var role = data.role ? data.role.toUpperCase() : "VIEWER";

    // Kiểm tra dữ liệu đầu vào bắt buộc
    if (!userEmail || !fileId) {
      return createJsonResponse({ 
        status: "error", 
        message: "Thiếu thông tin bắt buộc (userEmail hoặc fileId)" 
      }, 400);
    }

    // Tạo link kết nối thông minh trỏ về Web Router trên GitHub Pages
    var connectUrl = "https://tuanta3012.github.io/sotietkiem/connect.html" +
      "?fileId=" + encodeURIComponent(fileId) +
      "&workspaceName=" + encodeURIComponent(workspaceName) +
      "&adminName=" + encodeURIComponent(adminName);

    var roleLabel = role === "EDITOR" ? "Người chỉnh sửa (Editor)" : "Người xem (Viewer)";

    // Tiêu đề Email
    var subject = "🚀 [Sổ Tiết Kiệm] Lời mời tham gia không gian: " + workspaceName;

    // Nội dung HTML của Email
    var htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; padding: 30px 15px;">
          <tr>
            <td align="center">
              <table width="100%" max-width="560" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
                
                <!-- Header Banner -->
                <tr>
                  <td style="background: linear-gradient(135deg, #059669 0%, #0d9488 100%); padding: 30px 25px; text-align: center;">
                    <div style="font-size: 36px; margin-bottom: 8px;">💰</div>
                    <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">SỔ TIẾT KIỆM GIA ĐÌNH</h1>
                    <p style="margin: 5px 0 0 0; color: #d1fae5; font-size: 13px; font-weight: 500;">Không gian quản lý tài chính an toàn & đồng bộ</p>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding: 30px 25px;">
                    <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #e2e8f0;">
                      Xin chào,
                    </p>
                    <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
                      <strong style="color: #34d399;">${adminName}</strong> vừa mời bạn tham gia cùng quản lý và theo dõi không gian tài sản:
                    </p>

                    <!-- Workspace Info Box -->
                    <div style="background-color: #0f172a; border: 1px solid #334155; border-radius: 12px; padding: 18px; margin-bottom: 25px;">
                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="font-size: 12px; color: #94a3b8; padding-bottom: 4px;">Không gian làm việc:</td>
                        </tr>
                        <tr>
                          <td style="font-size: 16px; font-weight: 700; color: #f8fafc; padding-bottom: 12px;">${workspaceName}</td>
                        </tr>
                        <tr>
                          <td style="font-size: 12px; color: #94a3b8; padding-bottom: 4px;">Vai trò được cấp:</td>
                        </tr>
                        <tr>
                          <td>
                            <span style="display: inline-block; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
                              ${roleLabel}
                            </span>
                          </td>
                        </tr>
                      </table>
                    </div>

                    <!-- Call To Action Button -->
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 25px;">
                      <tr>
                        <td align="center">
                          <a href="${connectUrl}" target="_blank" style="display: inline-block; width: 85%; max-width: 320px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; padding: 14px 20px; border-radius: 12px; text-align: center; box-shadow: 0 10px 15px -3px rgba(16, 185, 129, 0.4);">
                            🚀 Mở & Liên Kết Ngay
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 0 0 8px 0; font-size: 12px; line-height: 1.5; color: #94a3b8; text-align: center;">
                      Nếu nút bấm không hoạt động, bạn hãy sao chép và mở liên kết dưới đây trên điện thoại:
                    </p>
                    <p style="margin: 0 0 20px 0; font-size: 11px; line-height: 1.4; color: #38bdf8; word-break: break-all; text-align: center;">
                      <a href="${connectUrl}" style="color: #38bdf8; text-decoration: underline;">${connectUrl}</a>
                    </p>

                    <div style="border-top: 1px solid #334155; padding-top: 18px; margin-top: 20px;">
                      <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                        🔒 <strong>Bảo mật:</strong> Ứng dụng chỉ sử dụng quyền truy cập đối với tệp này qua Google Drive OAuth (<code style="color: #34d399;">drive.file</code>). Dữ liệu hoàn toàn riêng tư trên tài khoản Google cá nhân.
                      </p>
                    </div>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #0f172a; padding: 15px 25px; text-align: center; border-top: 1px solid #334155;">
                    <p style="margin: 0; font-size: 11px; color: #64748b;">
                      Ứng Dụng Quản Lý Sổ Tiết Kiệm & Tài Sản Gia Đình • 2026
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Gửi email qua Gmail API của chủ tài khoản Google Apps Script
    GmailApp.sendEmail(userEmail, subject, "", {
      htmlBody: htmlBody,
      name: "Sổ Tiết Kiệm Gia Đình",
    });

    return createJsonResponse({
      status: "success",
      message: "Đã gửi email lời mời thành công tới " + userEmail,
      recipient: userEmail,
      connectUrl: connectUrl
    }, 200);

  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: "Lỗi xử lý gửi email: " + error.toString()
    }, 500);
  }
}

/**
 * Xử lý yêu cầu HTTP GET (Kiểm tra trạng thái hoạt động của Webhook)
 */
function doGet(e) {
  return createJsonResponse({
    status: "active",
    service: "So Tiet Kiem Invite Mailer Webhook",
    timestamp: new Date().toISOString()
  }, 200);
}

/**
 * Helper tạo phản hồi JSON kèm Header CORS
 */
function createJsonResponse(data, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
