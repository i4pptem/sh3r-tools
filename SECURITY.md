# Security

For antivirus detections, file hashes and the limits of the native-plugin investigation, see [Antivirus verification](docs/ANTIVIRUS.md). A generic detection name alone does not establish either infection or a false positive.

This application parses binary archives, images, models and media. Treat downloaded assets/projects as untrusted. Blender exchange opens files with Python auto-execution disabled; external media tools run without a shell. These measures do not eliminate vulnerabilities in native parsers or third-party tools.

For a suspected security issue, use the repository's private vulnerability-reporting feature if enabled. If it is unavailable, open an issue requesting a private reporting channel without publishing an exploit, sensitive files or personal information. No dedicated response time is promised.

Include the version, affected feature, expected impact and a minimal synthetic reproduction when possible. Do not upload game files or secrets. Ordinary format incompatibilities and rendering defects belong in the normal bug tracker.
