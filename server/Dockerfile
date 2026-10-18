# Bygger servern för samma arkitektur som NAS:en (x64 eller arm64).
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
ARG TARGETARCH
WORKDIR /src
COPY Matpref.Server/Matpref.Server.csproj Matpref.Server/
RUN dotnet restore Matpref.Server -a $TARGETARCH
COPY Matpref.Server/ Matpref.Server/
RUN dotnet publish Matpref.Server -a $TARGETARCH --no-restore -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
WORKDIR /app
COPY --from=build /app .
# Databasen ligger i /data, montera en volym där så att den överlever uppdateringar.
RUN mkdir /data && chown $APP_UID /data
VOLUME /data
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
# /healthz kräver ingen nyckel. Kollar ofta i början så att containern snabbt blir "healthy" (och TrueNAS slutar visa Deploying).
HEALTHCHECK --interval=1m --timeout=5s --start-period=1m --start-interval=2s CMD wget -qO /dev/null http://127.0.0.1:8080/healthz || exit 1
# Versionen som /api/version visar. Sätts av .github/workflows/server-image.yml. Sist, så att den inte påverkar cachen.
ARG VERSION=dev
ARG BUILT=
ENV MATPREF_VERSION=$VERSION MATPREF_BUILT=$BUILT
ENTRYPOINT ["dotnet", "Matpref.Server.dll"]
