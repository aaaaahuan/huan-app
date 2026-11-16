import Foundation
import CryptoKit

// 两端共用此协议实现；与 iOS/PersonalHub/Ideas/IdeaTable.swift 保持一致。
struct IdeaEntry: Codable, Sendable { let id: String; let text: String; let timestamp: String }
struct IdeaSnapshot: Codable, Sendable { let entries: [IdeaEntry]; let path: String; var savedID: String? }
struct IdeaReceipt: Codable { let line: String; let occurrence: Int; var committed: Bool }
enum IdeaTable {
    static let header = "| 灵感 | 时间戳 |\n| --- | --- |\n"
    static func error(_ text: String) -> NSError { NSError(domain:"HuanIdeas",code:1,userInfo:[NSLocalizedDescriptionKey:text]) }
    static func encode(_ text: String) -> String {
        text.replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"<",with:"&lt;")
            .replacingOccurrences(of:">",with:"&gt;").replacingOccurrences(of:"|",with:"&#124;")
            .replacingOccurrences(of:"\r\n",with:"\n").replacingOccurrences(of:"\r",with:"\n").replacingOccurrences(of:"\n",with:"<br>")
    }
    static func decode(_ text: String) -> String {
        text.replacingOccurrences(of:"<br>",with:"\n").replacingOccurrences(of:"&#124;",with:"|")
            .replacingOccurrences(of:"&lt;",with:"<").replacingOccurrences(of:"&gt;",with:">").replacingOccurrences(of:"&amp;",with:"&")
    }
    static func rows(_ content: String) throws -> [String] {
        let lines = content.replacingOccurrences(of:"\r\n",with:"\n").trimmingCharacters(in:CharacterSet(charactersIn:"\u{feff}")).split(separator:"\n",omittingEmptySubsequences:true).map(String.init)
        if lines.isEmpty { return [] }
        guard lines.count >= 2, lines[0].replacingOccurrences(of:" ",with:"") == "|灵感|时间戳|",
              lines[1].replacingOccurrences(of:" ",with:"") == "|---|---|" else { throw error("灵感.md 的表头已变化，请在 Obsidian 中保留“灵感｜时间戳”两列表格。原文件未覆盖。") }
        return try lines.dropFirst(2).map { line in
            let parts = line.split(separator:"|",omittingEmptySubsequences:false)
            guard parts.count == 4, parts[0].isEmpty, parts[3].isEmpty,
                  parts[2].trimmingCharacters(in:.whitespaces).range(of:#"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$"#,options:.regularExpression) != nil else { throw error("灵感表格中存在无法识别的行。请先在 Obsidian 修复；原文已保留。") }
            return line
        }
    }
    static func entries(_ rows: [String]) -> [IdeaEntry] {
        var counts: [String:Int] = [:]
        return rows.map { line in
            counts[line,default:0] += 1
            let key = line + "#\(counts[line]!)"
            let id = SHA256.hash(data:Data(key.utf8)).map { String(format:"%02x",$0) }.joined()
            let parts = line.split(separator:"|",omittingEmptySubsequences:false)
            return IdeaEntry(id:id,text:decode(parts[1].trimmingCharacters(in:.whitespaces)),timestamp:parts[2].trimmingCharacters(in:.whitespaces))
        }
    }
    static func merged(_ base: [String], _ other: [String]) -> [String] {
        var result=base, have: [String:Int]=[:], seen: [String:Int]=[:]
        for row in base { have[row,default:0] += 1 }
        for row in other { seen[row,default:0] += 1; if seen[row,default:0] > have[row,default:0] { result.append(row) } }
        return result
    }
    static func timestamp(_ date: Date = .now) -> String {
        let f=DateFormatter(); f.locale=Locale(identifier:"en_US_POSIX"); f.calendar=Calendar(identifier:.gregorian)
        f.timeZone=TimeZone(identifier:"Asia/Shanghai"); f.dateFormat="yyyy-MM-dd HH:mm:ss"; return f.string(from:date)
    }
    static func perform(directory: URL, receiptsURL: URL, requestID: String? = nil, text: String? = nil) throws -> IdeaSnapshot {
        let namespace=SHA256.hash(data:Data(directory.path.utf8)).map { String(format:"%02x",$0) }.joined()
        let receiptsURL=receiptsURL.deletingLastPathComponent().appendingPathComponent(namespace+".json")
        let fm=FileManager.default
        // 指定目录必须已经存在，避免失效的 iCloud URL 导致写入另一个目录。
        let values: URLResourceValues
        do { values=try directory.resourceValues(forKeys:[.isDirectoryKey,.isSymbolicLinkKey]) }
        catch { throw self.error("无法访问灵感文件夹，请确认 iCloud 已下载该目录，或重新连接文件夹。草稿已保留。") }
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw error("灵感文件夹不可用，请重新连接。") }
        let file=directory.appendingPathComponent("灵感.md")
        if fm.fileExists(atPath:file.path) {
            let info=try file.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey])
            guard info.isRegularFile == true, info.isSymbolicLink != true else { throw error("灵感.md 必须是普通文件。") }
        }
        var result: Result<IdeaSnapshot,Error> = .failure(error("未完成文件协调，请重试。"))
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt:file,options:[],error:&coordinationError) { coordinated in
            result = Result {
                let original=fm.fileExists(atPath:coordinated.path) ? try String(contentsOf:coordinated,encoding:.utf8) : ""
                var rows=try self.rows(original)
                let versions=NSFileVersion.unresolvedConflictVersionsOfItem(at:coordinated) ?? []
                for version in versions { rows=merged(rows,try self.rows(String(contentsOf:version.url,encoding:.utf8))) }
                var receipts: [String:IdeaReceipt] = [:]
                if fm.fileExists(atPath:receiptsURL.path) { receipts=try JSONDecoder().decode([String:IdeaReceipt].self,from:Data(contentsOf:receiptsURL)) }
                func saveReceipts() throws {
                    try fm.createDirectory(at:receiptsURL.deletingLastPathComponent(),withIntermediateDirectories:true)
                    try JSONEncoder().encode(receipts).write(to:receiptsURL,options:.atomic)
                }
                if let id=requestID, let text=text {
                    let trimmed=text.trimmingCharacters(in:.whitespacesAndNewlines)
                    guard !trimmed.isEmpty, trimmed.utf8.count <= 100_000, UUID(uuidString:id) != nil else { throw error("请输入有效的灵感内容（最多 100 KB）。") }
                    if let receipt=receipts[id] {
                        let expected="| \(encode(trimmed)) |"
                        guard receipt.line.hasPrefix(expected) else { throw error("重试内容已变化，请重新提交。") }
                    } else {
                        let line="| \(encode(trimmed)) | \(timestamp()) |"
                        receipts[id]=IdeaReceipt(line:line,occurrence:rows.filter { $0 == line }.count+1,committed:false)
                        // 先持久化本机回执，再写共享文件，崩溃或 IPC 超时重试不会重复追加。
                        try saveReceipts()
                    }
                }
                for receipt in receipts.values where !receipt.committed {
                    let count=rows.filter { $0 == receipt.line }.count
                    if count < receipt.occurrence { rows.append(contentsOf:repeatElement(receipt.line,count:receipt.occurrence-count)) }
                }
                let currentRows=try self.rows(original)
                if rows != currentRows || (!rows.isEmpty && original.isEmpty) {
                    let content=header+rows.joined(separator:"\n")+"\n"
                    try Data(content.utf8).write(to:coordinated,options:.atomic)
                }
                // 只有完整合并并落盘后才标记冲突已处理，不丢弃无法解析的版本。
                for version in versions { version.isResolved=true }
                for key in receipts.keys { receipts[key]?.committed=true }
                if !receipts.isEmpty { try saveReceipts() }
                let parsed=entries(rows)
                let savedID=requestID.flatMap { id in receipts[id].flatMap { receipt in
                    let matching=zip(rows,parsed).filter { $0.0 == receipt.line }.map { $0.1.id }
                    return receipt.occurrence <= matching.count ? matching[receipt.occurrence-1] : nil
                } }
                return IdeaSnapshot(entries:parsed,path:coordinated.path,savedID:savedID)
            }
        }
        if let error=coordinationError { throw error }
        return try result.get()
    }
}
